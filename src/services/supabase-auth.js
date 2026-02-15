/**
 * Supabase auth stub — Supabase has been removed.
 * Some legacy controllers still import this file. All methods return errors
 * to surface any accidental usage.
 */
const notSupported = (method) => () => {
  throw new Error(`${method} is not supported — Supabase has been removed. Use v2 auth/DAL instead.`);
};

const adminStub = {
  getUser: notSupported('adminAuth.getUser'),
  admin: {
    getUserById: notSupported('adminAuth.admin.getUserById'),
    updateUserById: notSupported('adminAuth.admin.updateUserById'),
    listUsers: notSupported('adminAuth.admin.listUsers'),
    createUser: notSupported('adminAuth.admin.createUser'),
  },
};

module.exports = {
  auth: { signInWithPassword: notSupported('auth.signInWithPassword') },
  adminAuth: adminStub,
  storage: { from: notSupported('storage.from') },
};
