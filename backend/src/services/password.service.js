const bcrypt = require('bcryptjs');
const { BCRYPT_ROUNDS } = require('../config/env');

const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);
const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// Compared against when the email is unknown, so both failure paths take similar time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

module.exports = { hashPassword, verifyPassword, DUMMY_HASH };
