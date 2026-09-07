// netlify/functions/create-checkout-session.js
//
// Creates a Stripe Checkout Session in subscription mode.
// Apple Pay needs ZERO extra setup here — Stripe Checkout shows it
// automatically to eligible visitors (Safari on Mac/iPhone/iPad with a
// card in Apple Wallet, served over HTTPS — which Netlify already gives you).
//
// The client sends the exact Stripe Price ID for whichever plan/billing-cycle
// button was clicked (e.g. price_xxx for "Standard, monthly"), so this one
// function supports all of your pricing tiers without changes here.
//
// Required Netlify environment variables (Site settings -> Environment variables):
//   STRIPE_SECRET_KEY   sk_live_... (or sk_test_... while testing)
//   PUBLIC_SITE_URL     https://your-site.netlify.app  (no trailing slash)

const Stripe = require('stripe');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const { priceId, userId, email } = JSON.parse(event.body || '{}');

    if (!priceId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing priceId' }) };
    }
    if (!userId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId' }) };
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email || undefined,
      // carries your Supabase user id through to the webhook so we know
      // whose subscription this is when payment succeeds
      client_reference_id: userId,
      subscription_data: { metadata: { supabase_user_id: userId } },
      success_url: `${process.env.PUBLIC_SITE_URL}/?checkout=success`,
      cancel_url: `${process.env.PUBLIC_SITE_URL}/?checkout=cancelled`,
      allow_promotion_codes: true,
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error('create-checkout-session error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
