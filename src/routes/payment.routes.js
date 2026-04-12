const express    = require('express');
const router     = express.Router();
const { createCheckoutSession, getPaymentStatus } = require('../controllers/payment.controller');

// Public — no auth required.
// A pending teamId is the authorization token: if you have it, you can pay for it.
// Amount is always re-computed server-side from the competition fee.
router.post('/checkout', createCheckoutSession);
router.get('/status',   getPaymentStatus);

module.exports = router;
