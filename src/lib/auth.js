const { betterAuth } = require('better-auth');
const { mongodbAdapter } = require('better-auth/adapters/mongodb');
const { organization } = require('better-auth/plugins');
const { MongoClient } = require('mongodb');

const client = new MongoClient(process.env.MONGODB_URI);

const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3001',
  secret: process.env.BETTER_AUTH_SECRET,
  // mongodbAdapter expects a Db instance, not the MongoClient.
  // Explicit db name as fallback — avoids defaulting to 'test' if the URI has no db path.
  database: mongodbAdapter(client.db(process.env.MONGODB_DB_NAME || 'padel')),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    },
  },

  plugins: [
    organization({
      // Users can create orgs; ownership is tracked via the `owner` role
      allowUserToCreateOrganization: true,
    }),
  ],

  // Extend the user table with a global role field
  user: {
    additionalFields: {
      role: {
        type: 'string',
        defaultValue: 'player',
        // Allow clients to send `role` on sign-up
        input: true,
      },
    },
  },

  // Accepted origins for CORS / cookie trust
  trustedOrigins: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
  ],
});

module.exports = { auth };
