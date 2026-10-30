import { authenticated, signIn, signOut } from '../../_lib/sponsorship-auth.js';
import { json } from '../../_lib/sponsorship-store.js';

export const onRequestGet = async ({ request, env }) => json({ authenticated: await authenticated(request, env) });
export const onRequestPost = async ({ request, env }) => signIn(request, env);
export const onRequestDelete = async ({ request }) => signOut(request);
