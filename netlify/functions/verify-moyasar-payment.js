// netlify/functions/verify-moyasar-payment.js
//
// Moyasar redirects the browser here (as the checkout callback_url) after
// the customer finishes paying. NEVER trust that redirect alone — this
// function re-fetches the payment from Moyasar's API using the SECRET key
// and checks status/amount/currency itself before marking anything paid.
//
// Required Netlify environment variables:
//   MOYASAR_SECRET_KEY         sk_test_... (or sk_live_... when you go live)
//   SUPABASE_URL                https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   Supabase -> Project Settings -> API -> service_role key
//   PUBLIC_SITE_URL             https://your-site.netlify.app (no trailing slash)

const { createClient } = require('@supabase/supabase-js');

const PLAN_DURATIONS = { monthly: 30, yearly: 365 }; // days added to current_period_end

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const paymentId = params.id; // Moyasar appends this to the callback URL automatically
  const { userId, plan, cycle, expectedAmount } = params;
  const siteUrl = process.env.PUBLIC_SITE_URL;

  function redirect(status) {
    return { statusCode: 302, headers: { Location: `${siteUrl}/?checkout=${status}` } };
  }

  if (!paymentId || !userId) return redirect('cancelled');

  try {
    const auth = Buffer.from(`${process.env.MOYASAR_SECRET_KEY}:`).toString('base64');
    const res = await fetch(`https://api.moyasar.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    const payment = await res.json();

    const amountOk = !expectedAmount || payment.amount === parseInt(expectedAmount, 10);
    if (payment.status !== 'paid' || payment.currency !== 'SAR' || !amountOk) {
      console.error('Moyasar payment verification failed:', payment.status, payment.amount, expectedAmount);
      return redirect('cancelled');
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const days = PLAN_DURATIONS[cycle] || 30;
    const periodEnd = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    await supabase.from('subscriptions').upsert({
      user_id: userId,
      moyasar_payment_id: paymentId,
      status: 'active',
      plan: plan || null,
      cycle: cycle || 'monthly',
      current_period_end: periodEnd,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    return redirect('success');
  } catch (err) {
    console.error('verify-moyasar-payment error:', err);
    return redirect('cancelled');
  }
};
