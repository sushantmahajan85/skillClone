const DodoPaymentsImport = require('dodopayments');

const DodoPayments = DodoPaymentsImport.default || DodoPaymentsImport;

const client = new DodoPayments({
  bearerToken: process.env.DODO_API_KEY,
  environment: process.env.DODO_ENVIRONMENT || 'live_mode',
  webhookKey: process.env.DODO_WEBHOOK_SECRET
});

const dodoPayments = {
  // Uses official SDK method: client.customers.create(...)
  async createSellerAccount({ email, name, metadata = {} }) {
    return client.customers.create({
      email,
      name,
      metadata
    });
  },

  // Uses official SDK method: client.checkoutSessions.create(...)
  async createCheckoutSession({ amount, merchantId, platformFee, metadata = {}, customer = {} }) {
    const payload = {
      product_cart: [
        {
          product_id: process.env.DODO_PRODUCT_ID,
          quantity: 1
        }
      ],
      metadata: {
        ...metadata,
        merchantId,
        platformFee: String(platformFee)
      }
    };

    if (customer.email || customer.name || customer.phone_number) {
      payload.customer = customer;
    }

    if (process.env.FRONTEND_URL) {
      payload.return_url = `${process.env.FRONTEND_URL}/checkout/success`;
    }

    // Some setups support overriding amount for pay-what-you-want style checkouts.
    if (typeof amount === 'number') {
      payload.amount = amount;
    }

    return client.checkoutSessions.create(payload);
  },

  unwrapWebhook(rawBodyBuffer, headers = {}) {
    const payloadString = Buffer.isBuffer(rawBodyBuffer) ? rawBodyBuffer.toString('utf-8') : String(rawBodyBuffer);
    const normalizedHeaders = {
      'webhook-id': String(headers['webhook-id'] || ''),
      'webhook-signature': String(headers['webhook-signature'] || ''),
      'webhook-timestamp': String(headers['webhook-timestamp'] || '')
    };

    return client.webhooks.unwrap(payloadString, {
      headers: normalizedHeaders,
      key: process.env.DODO_WEBHOOK_SECRET
    });
  },

  verifyWebhookSignature(rawBodyBuffer, headers = {}) {
    try {
      dodoPayments.unwrapWebhook(rawBodyBuffer, headers);
      return true;
    } catch (error) {
      return false;
    }
  }
};

module.exports = dodoPayments;
