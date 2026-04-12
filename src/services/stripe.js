const Stripe = require('stripe');

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('[stripe] STRIPE_SECRET_KEY not set — payment features disabled');
}

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
  : null;

module.exports = stripe;
