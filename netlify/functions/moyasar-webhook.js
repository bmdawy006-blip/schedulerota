// netlify/functions/moyasar-webhook.js
//
// Async safety net: Moyasar also calls this URL directly from its own
// servers whenever a payment succeeds/fails, independent of whether the
// customer's browser made it back to verify-moyasar-payment.js. Register
// this URL in the Moyasar Dashboard -> Webhooks:
//   https://your-site.netlify.app/.netlify/functions/moyasar-webhook
//
// Required Netlify environment variables (same as verify-moyasar-payment.js):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const { createClient } = require('@supabase/supabase-js');

const PLAN_DURATIONS = { monthly: 30, yearly: 365 };

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const body = JSON.parse(event.body || '{}');
    // Moyasar webhook payloads wrap the payment under `data` — see
    // https://docs.moyasar.com for the exact current shape, and adjust
    // this line if their format differs from what you see in your
    // Dashboard -> Webhooks -> test delivery logs.
    const payment = body.data || body;

    if (body.type !== 'payment_paid' && payment.status !== 'paid') {
      return { statusCode: 200, body: JSON.stringify({ ignored: true }) };
    }

    const userId = payment.metadata && payment.metadata.supabase_user_id;
    if (!userId) return { statusCode: 200, body: JSON.stringify({ ignored: 'no user id in metadata' }) };

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const cycle = (payment.metadata && payment.metadata.cycle) || 'monthly';
    const days = PLAN_DURATIONS[cycle] || 30;
    const periodEnd = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    await supabase.from('subscriptions').upsert({
      user_id: userId,
      moyasar_payment_id: payment.id,
      status: 'active',
      plan: (payment.metadata && payment.metadata.plan) || null,
      cycle,
      current_period_end: periodEnd,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('moyasar-webhook error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
