/**
 * Supabase project for sign-in, sync and sharing. Both values are public by
 * design (every visitor's browser sees them); access is enforced by the
 * row-level security rules in supabase/setup.sql. Leave them empty and the
 * app runs exactly as before, local only.
 */
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? 'https://bnwoviixtfvqumvhoftt.supabase.co';
export const SUPABASE_KEY: string = import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_4B0xzx-a-5d-mlmJbH1Sgg_N2iyCNCN';

export const cloudConfigured = !!(SUPABASE_URL && SUPABASE_KEY);
