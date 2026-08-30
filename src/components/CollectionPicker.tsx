import React, { useEffect, useRef, useState } from 'react';
import { Check, FolderPlus, Loader2 } from 'lucide-react';
import { Collection } from '../utils/collections';

interface CollectionPickerProps {
  collections: Collection[];
  assignedCollectionIds: string[];
  onToggleCollection: (collection: Collection, shouldInclude: boolean) => Promise<void> | void;
}

export const CollectionPicker: React.FC<CollectionPickerProps> = ({
  collections,
  assignedCollectionIds,
  onToggleCollection
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingCollectionId, setPendingCollectionId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleToggle = async (collection: Collection) => {
    const shouldInclude = !assignedCollectionIds.includes(collection.id);
    setPendingCollectionId(collection.id);

    try {
      await onToggleCollection(collection, shouldInclude);
    } finally {
      setPendingCollectionId(null);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="transition-colors p-1.5 rounded-full text-gray-400 hover:text-blue-600 hover:bg-blue-50"
        title="Add to collections"
      >
        <FolderPlus className="w-3.5 h-3.5" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-10 z-20 w-72 rounded-xl border border-gray-200 bg-white shadow-xl p-3">
          <div className="mb-2">
            <p className="text-sm font-semibold text-gray-900">Collections</p>
            <p className="text-xs text-gray-500">Add this project to one or more collections.</p>
          </div>

          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {collections.length > 0 ? collections.map((collection) => {
              const isAssigned = assignedCollectionIds.includes(collection.id);
              const isPending = pendingCollectionId === collection.id;

              return (
                <button
                  key={collection.id}
                  type="button"
                  onClick={() => handleToggle(collection)}
                  disabled={isPending}
                  className={`w-full flex items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                    isAssigned
                      ? 'border-blue-200 bg-blue-50'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                  } ${isPending ? 'opacity-70 cursor-wait' : ''}`}
                >
                  <span className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded border ${
                    isAssigned ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-300 bg-white text-transparent'
                  }`}>
                    {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900 truncate">{collection.name}</span>
                    <span className="block text-xs text-gray-500 line-clamp-2">
                      {collection.description?.trim() || 'No description yet.'}
                    </span>
                  </span>
                </button>
              );
            }) : (
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">
                Create a custom collection first.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
