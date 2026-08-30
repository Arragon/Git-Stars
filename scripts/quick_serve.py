from __future__ import annotations

import argparse
import contextlib
import socket
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
from typing import Iterable


DEFAULT_COMMON_PORTS = [5173, 4173, 3000, 8000, 8080, 5000, 4000, 9000, 8888]


def _parse_ports(value: str) -> list[int]:
    parts = [p.strip() for p in value.replace(";", ",").split(",") if p.strip()]
    ports: list[int] = []
    for p in parts:
        port = int(p)
        if not (0 <= port <= 65535):
            raise argparse.ArgumentTypeError(f"Invalid port: {port}")
        ports.append(port)
    if not ports:
        raise argparse.ArgumentTypeError("Empty ports list")
    return ports


def _is_port_free(host: str, port: int) -> bool:
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
        except OSError:
            return False
        return True


def _choose_port(host: str, preferred: int | None, common_ports: Iterable[int]) -> int:
    if preferred == 0:
        return 0

    if preferred is not None and preferred != 0:
        if not _is_port_free(host, preferred):
            raise RuntimeError(f"Port {preferred} is already in use")
        return preferred

    for p in common_ports:
        if p == 0:
            continue
        if _is_port_free(host, p):
            return p

    return 0


def _best_default_dir() -> Path:
    repo_root = Path(__file__).resolve().parent.parent
    dist_dir = repo_root / "dist"
    if dist_dir.is_dir():
        return dist_dir
    return repo_root


def _make_handler(directory: str):
    class Handler(SimpleHTTPRequestHandler):
        spa_fallback: bool = False
        spa_index: str = "index.html"

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=directory, **kwargs)

        def _maybe_spa_fallback(self) -> None:
            if not self.spa_fallback:
                return

            request_path = unquote(urlparse(self.path).path or "/")
            if request_path.endswith("/"):
                return

            if Path(request_path).suffix:
                return

            local_path = Path(self.translate_path(request_path))
            if local_path.exists():
                return

            index_path = "/" + self.spa_index.lstrip("/")
            local_index = Path(self.translate_path(index_path))
            if not local_index.exists():
                return

            self.path = index_path

        def send_head(self):
            self._maybe_spa_fallback()
            return super().send_head()

    return Handler


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Quickly start a local static file server with a chosen or auto-selected port."
    )
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="Bind port. If omitted, auto-select from common ports. Use 0 for OS-assigned port.",
    )
    parser.add_argument(
        "--common-ports",
        type=_parse_ports,
        default=None,
        help='Comma-separated ports to try first (e.g. "5173,3000,8000").',
    )
    parser.add_argument(
        "--dir",
        default=None,
        help="Directory to serve. Default: ./dist if exists, otherwise repo root.",
    )
    parser.add_argument(
        "--spa",
        action="store_true",
        help="SPA fallback: serve index.html for unknown paths without file extension.",
    )
    parser.add_argument(
        "--index",
        default="index.html",
        help="Index file for SPA fallback (default: index.html).",
    )
    parser.add_argument(
        "--open",
        action="store_true",
        help="Open the URL in the default browser after start.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Less output.",
    )
    args = parser.parse_args(argv)

    common_ports = args.common_ports or DEFAULT_COMMON_PORTS
    directory = Path(args.dir).expanduser().resolve() if args.dir else _best_default_dir()
    if not directory.exists() or not directory.is_dir():
        raise SystemExit(f"Directory does not exist: {directory}")

    port = _choose_port(args.host, args.port, common_ports)
    handler = _make_handler(str(directory))
    handler.spa_fallback = bool(args.spa)
    handler.spa_index = args.index

    httpd = ThreadingHTTPServer((args.host, port), handler)
    chosen_port = httpd.server_address[1]
    url = f"http://{args.host}:{chosen_port}/"

    if not args.quiet:
        print(f"Serving: {directory}", flush=True)
        print(f"Listening: {url}", flush=True)
        if args.spa:
            print(f"SPA fallback: {args.index}", flush=True)
        print("Stop with Ctrl+C", flush=True)

    if args.open:
        def _opener():
            time.sleep(0.2)
            webbrowser.open(url)

        threading.Thread(target=_opener, daemon=True).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

