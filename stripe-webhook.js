// netlify/functions/stripe-webhook.js
//
// Receives events from Stripe (payment succeeded, subscription renewed,
// cancelled, etc.) and writes the current status into Supabase so the app
// knows whether a user's subscription is active.
//
// Required Netlify environment variables:
//   STRIPE_SECRET_KEY          sk_live_... (or sk_test_...)
//   STRIPE_WEBHOOK_SECRET      whsec_...   (from the Stripe Dashboard webhook you create)
//   SUPABASE_URL               https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  the service_role key (Supabase -> Project Settings -> API)
//                              NEVER expose this key client-side — it bypasses RLS,
//                              which is exactly what this server-side function needs.
//
// Also run subscriptions.sql (next to this file) in the Supabase SQL editor once.

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      event.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  async function upsertFromSubscription(sub) {
    const userId = sub.metadata && sub.metadata.supabase_user_id;
    if (!userId) return; // not one of ours (or metadata missing) — ignore safely
    await supabase.from('subscriptions').upsert({
      user_id: userId,
      stripe_customer_id: sub.customer,
      stripe_subscription_id: sub.id,
      status: sub.status, // 'active' | 'trialing' | 'past_due' | 'canceled' | ...
      plan: sub.items.data[0]?.price?.recurring?.interval || null, // 'month' | 'year'
      current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  }

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        if (session.mode === 'subscription' && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          await upsertFromSubscription(sub);
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
      case 'customer.subscription.deleted': {
        await upsertFromSubscription(stripeEvent.data.object);
        break;
      }
      default:
        break; // ignore events we don't need
    }
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('stripe-webhook handler error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
