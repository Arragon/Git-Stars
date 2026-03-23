import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function test() {
  // Let's sign up a dummy user or just sign in
  const { data: authData, error: authErr } = await supabase.auth.signUp({
    email: 'test' + Date.now() + '@example.com',
    password: 'password123',
  });
  
  if (authErr) {
    console.error('Auth err:', authErr);
    return;
  }
  
  const userId = authData.user!.id;
  console.log('Authed as:', userId);
  
  const { data: userData, error: userError } = await supabase
    .from('users')
    .upsert({
      id: userId,
      github_id: 'test_github_id_' + Date.now(),
      username: 'test_username',
    }, { onConflict: 'id' })
    .select();
    
  console.log('User Upsert:', userData, userError);
}
test();