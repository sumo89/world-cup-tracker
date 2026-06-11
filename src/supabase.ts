import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase credentials not configured. Using localStorage only.')
}

export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null

export type DbUser = {
  id: string
  name: string
  created_at: string
}

export type DbPrediction = {
  id: string
  user_id: string
  fixture_id: number
  choice: 'home' | 'draw' | 'away'
  created_at: string
}
