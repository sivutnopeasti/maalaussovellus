// Supabase Edge Function: send push notifications via Expo Push API
// Deploy: supabase functions deploy send-push-notification

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface PushPayload {
  project_id: string;
  sender_id: string;
  title: string;
  body: string;
  type: 'chat_message' | 'phase_update';
}

serve(async (req: Request) => {
  try {
    const payload: PushPayload = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get all project members except the sender
    const { data: members } = await supabase
      .from('project_members')
      .select('user_id')
      .eq('project_id', payload.project_id)
      .neq('user_id', payload.sender_id);

    if (!members || members.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    const userIds = members.map((m: { user_id: string }) => m.user_id);

    // Get push tokens for those users
    const { data: profiles } = await supabase
      .from('profiles')
      .select('push_token')
      .in('id', userIds)
      .not('push_token', 'is', null);

    if (!profiles || profiles.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    const messages = profiles
      .filter((p: { push_token: string | null }) => p.push_token)
      .map((p: { push_token: string }) => ({
        to: p.push_token,
        sound: 'default',
        title: payload.title,
        body: payload.body,
        data: {
          project_id: payload.project_id,
          type: payload.type,
        },
      }));

    // Send via Expo Push API
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });

    const result = await response.json();

    return new Response(JSON.stringify({ sent: messages.length, result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
