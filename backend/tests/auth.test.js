const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.BCRYPT_ROUNDS = '4';

const { startTestDatabase } = require('./helpers/testDb');

const ADMIN = { email: 'owner@intharoute.test', password: 'AdminPass123' };
const PASSWORD = 'Passw0rd123';

const restaurantBody = (over = {}) => ({
  role: 'restaurant',
  email: 'staff@saffron.test',
  password: PASSWORD,
  fullName: 'Saffron Staff',
  phone: '020 8940 5521',
  restaurantName: 'Saffron Restaurant - Richmond',
  address: '5 Dome Buildings The Square, Richmond',
  postcode: 'tw91dt',
  ...over,
});

const driverBody = (over = {}) => ({
  role: 'driver',
  email: 'gustavo@rider.test',
  password: PASSWORD,
  fullName: 'Gustavo Oliveira',
  phone: '+44 7841 902145',
  vehicle: 'Motorcycle / Scooter',
  plateNumber: 'lr23 kxm',
  ...over,
});

let stopDb, app, pool, runMigrations, seedAdmin, authenticate, authorize, errorHandler, ROLES;
let rbacApp;
const session = {}; // role -> { user, tokens }

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const fields = (res) => (res.body.error.details || []).map((d) => d.field);

before(async () => {
  stopDb = await startTestDatabase();
  app = require('../src/app');
  ({ pool } = require('../src/config/db'));
  ({ runMigrations } = require('../src/db/migrate'));
  ({ seedAdmin } = require('../src/db/seedAdmin'));
  authenticate = require('../src/middleware/authenticate');
  authorize = require('../src/middleware/authorize');
  errorHandler = require('../src/middleware/errorHandler');
  ({ ROLES } = require('../src/constants/roles'));

  // Routes that exist only in tests, guarded by the real middleware.
  rbacApp = express();
  const ok = (req, res) => res.json({ role: req.user.role });
  rbacApp.get('/admin-only', authenticate, authorize(ROLES.ADMIN), ok);
  rbacApp.get('/restaurant-only', authenticate, authorize(ROLES.RESTAURANT), ok);
  rbacApp.get('/driver-only', authenticate, authorize(ROLES.DRIVER), ok);
  rbacApp.get('/restaurant-or-admin', authenticate, authorize(ROLES.RESTAURANT, ROLES.ADMIN), ok);
  rbacApp.get('/any-user', authenticate, ok);
  rbacApp.use(errorHandler);
});

after(async () => {
  if (pool) await pool.end();
  if (stopDb) await stopDb();
});

describe('migrations', () => {
  test('apply cleanly on an empty database', async () => {
    const ran = await runMigrations(pool, () => {});
    assert.deepEqual(ran, ['001_auth.sql', '002_operations.sql', '003_driver_location.sql']);
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`
    );
    assert.deepEqual(
      rows.map((r) => r.table_name),
      [
        'batch_declines',
        'batches',
        'driver_online_sessions',
        'driver_profiles',
        'files',
        'kyc_documents',
        'orders',
        'pricing_config',
        'refresh_tokens',
        'restaurants',
        'schema_migrations',
        'users',
      ]
    );
  });

  test('running again does nothing', async () => {
    assert.deepEqual(await runMigrations(pool, () => {}), []);
  });
});

describe('admin seeder', () => {
  const env = { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, ADMIN_NAME: 'Christian Bark' };

  test('refuses to run without credentials', async () => {
    await assert.rejects(seedAdmin(pool, {}, () => {}), /ADMIN_EMAIL and ADMIN_PASSWORD/);
  });

  test('refuses a weak password', async () => {
    await assert.rejects(seedAdmin(pool, { ...env, ADMIN_PASSWORD: 'short' }, () => {}), /too weak/);
  });

  test('creates the admin with a hashed password', async () => {
    const result = await seedAdmin(pool, env, () => {});
    assert.equal(result.created, true);
    const { rows } = await pool.query('SELECT role, password_hash FROM users WHERE email = $1', [ADMIN.email]);
    assert.equal(rows[0].role, 'admin');
    assert.match(rows[0].password_hash, /^\$2[aby]\$/);
    assert.notEqual(rows[0].password_hash, ADMIN.password);
  });

  test('is idempotent', async () => {
    const result = await seedAdmin(pool, { ...env, ADMIN_PASSWORD: 'Different999' }, () => {});
    assert.equal(result.created, false);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM users WHERE role = 'admin'`);
    assert.equal(rows[0].n, 1);
    // The original password still works.
    const res = await request(app).post('/api/auth/login').send(ADMIN);
    assert.equal(res.status, 200);
  });
});

describe('POST /api/auth/signup', () => {
  test('registers a restaurant', async () => {
    const res = await request(app).post('/api/auth/signup').send(restaurantBody());
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'restaurant');
    assert.equal(res.body.user.email, 'staff@saffron.test');
    assert.equal(res.body.user.phone, '02089405521');
    assert.equal(res.body.user.restaurant.name, 'Saffron Restaurant - Richmond');
    assert.equal(res.body.user.restaurant.postcode, 'TW9 1DT');
    assert.equal(res.body.user.restaurant.driverPolicy, 'open_platform');
    assert.equal(res.body.user.driver, undefined);
    assert.ok(res.body.tokens.accessToken);
    assert.ok(res.body.tokens.refreshToken);
    assert.equal(res.body.tokens.tokenType, 'Bearer');
    assert.ok(!JSON.stringify(res.body).includes('password'));
    session.restaurant = res.body;
  });

  test('registers a platform driver awaiting KYC', async () => {
    const res = await request(app).post('/api/auth/signup').send(driverBody());
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'driver');
    assert.deepEqual(
      { ...res.body.user.driver, id: undefined },
      {
        id: undefined,
        driverType: 'platform_contracted',
        employerRestaurantId: null,
        vehicle: 'Motorcycle / Scooter',
        plateNumber: 'LR23 KXM',
        status: 'pending_kyc',
      }
    );
    assert.equal(res.body.user.restaurant, undefined);
    session.driver = res.body;
  });

  test('stores a bcrypt hash, never the password', async () => {
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE email = $1', ['gustavo@rider.test']);
    assert.match(rows[0].password_hash, /^\$2[aby]\$/);
    assert.ok(!rows[0].password_hash.includes(PASSWORD));
  });

  test('ignores privileged fields sent by the client', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send(
        driverBody({
          email: 'sneaky@rider.test',
          driverType: 'restaurant_own',
          status: 'approved_online',
          isActive: false,
          id: '00000000-0000-0000-0000-000000000000',
          employerRestaurantId: session.restaurant.user.restaurant.id,
        })
      );
    assert.equal(res.status, 201);
    assert.equal(res.body.user.driver.driverType, 'platform_contracted');
    assert.equal(res.body.user.driver.status, 'pending_kyc');
    assert.equal(res.body.user.driver.employerRestaurantId, null);
    assert.equal(res.body.user.isActive, true);
    assert.notEqual(res.body.user.id, '00000000-0000-0000-0000-000000000000');
  });

  test('E-Bike driver does not need a plate', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send(driverBody({ email: 'ebike@rider.test', vehicle: 'E-Bike', plateNumber: undefined }));
    assert.equal(res.status, 201);
    assert.equal(res.body.user.driver.plateNumber, null);
  });

  test('other vehicles need a plate', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send(driverBody({ email: 'noplate@rider.test', vehicle: 'Car', plateNumber: '' }));
    assert.equal(res.status, 400);
    assert.deepEqual(fields(res), ['plateNumber']);
  });

  test('rejects public admin registration and creates nothing', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ role: 'admin', email: 'evil@admin.test', password: PASSWORD, fullName: 'Evil Admin', phone: '07700900001' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'ADMIN_SIGNUP_FORBIDDEN');
    const { rows } = await pool.query('SELECT 1 FROM users WHERE email = $1', ['evil@admin.test']);
    assert.equal(rows.length, 0);
  });

  for (const role of ['Admin', 'ADMIN', ' admin', 'superuser', '', null, undefined, ['admin'], { a: 1 }]) {
    test(`rejects role ${JSON.stringify(role)}`, async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send(driverBody({ role, email: 'role-probe@rider.test' }));
      assert.equal(res.status, 400);
      assert.deepEqual(fields(res), ['role']);
    });
  }

  test('no admin was created by any signup attempt', async () => {
    const { rows } = await pool.query(`SELECT email FROM users WHERE role = 'admin'`);
    assert.deepEqual(rows, [{ email: ADMIN.email }]);
  });

  test('rejects a duplicate email, case-insensitively', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send(driverBody({ email: 'Staff@SAFFRON.test' }));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'EMAIL_TAKEN');
  });

  test('a failed signup leaves no partial user behind', async () => {
    // A duplicate email fails inside the transaction, after validation has passed.
    const before = (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    await request(app).post('/api/auth/signup').send(restaurantBody());
    const afterCount = (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    assert.equal(afterCount, before);
  });

  const invalid = [
    ['invalid email', restaurantBody({ email: 'not-an-email' }), ['email']],
    ['short password', restaurantBody({ email: 'a@b.test', password: 'Ab1' }), ['password']],
    ['password without a digit', restaurantBody({ email: 'a@b.test', password: 'onlyletters' }), ['password']],
    ['password without a letter', restaurantBody({ email: 'a@b.test', password: '1234567890' }), ['password']],
    ['password over 72 characters', restaurantBody({ email: 'a@b.test', password: `a1${'x'.repeat(80)}` }), ['password']],
    ['non-UK phone', restaurantBody({ email: 'a@b.test', phone: '+1 415 555 0100' }), ['phone']],
    ['invalid postcode', restaurantBody({ email: 'a@b.test', postcode: '12345' }), ['postcode']],
    ['missing full name', restaurantBody({ email: 'a@b.test', fullName: ' ' }), ['fullName']],
    [
      'restaurant without its details',
      restaurantBody({ email: 'a@b.test', restaurantName: undefined, address: undefined, postcode: undefined }),
      ['restaurantName', 'address', 'postcode'],
    ],
    ['driver with an unknown vehicle', driverBody({ email: 'a@b.test', vehicle: 'Helicopter' }), ['vehicle']],
    ['driver without a vehicle', driverBody({ email: 'a@b.test', vehicle: undefined }), ['vehicle']],
    ['empty body for a role', { role: 'driver' }, ['email', 'password', 'fullName', 'phone', 'vehicle']],
  ];
  for (const [name, body, expected] of invalid) {
    test(`validation: ${name}`, async () => {
      const res = await request(app).post('/api/auth/signup').send(body);
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.deepEqual(fields(res).sort(), [...expected].sort());
    });
  }

  test('restaurant signup does not require driver fields, and vice versa', async () => {
    const r = await request(app).post('/api/auth/signup').send(restaurantBody({ email: 'second@rest.test', vehicle: 'Helicopter' }));
    assert.equal(r.status, 201);
    assert.equal(r.body.user.driver, undefined);
  });
});

describe('POST /api/auth/login', () => {
  test('signs in each role and reports the stored role', async () => {
    const cases = [
      ['restaurant', 'staff@saffron.test', PASSWORD],
      ['driver', 'gustavo@rider.test', PASSWORD],
      ['admin', ADMIN.email, ADMIN.password],
    ];
    for (const [role, email, password] of cases) {
      const res = await request(app).post('/api/auth/login').send({ email, password });
      assert.equal(res.status, 200, role);
      assert.equal(res.body.user.role, role);
      assert.equal(jwt.decode(res.body.tokens.accessToken).role, role);
      assert.ok(!JSON.stringify(res.body).includes('password'));
      session[role] = res.body;
    }
    assert.equal(session.admin.user.restaurant, undefined);
    assert.equal(session.admin.user.driver, undefined);
  });

  test('ignores a role supplied by the client', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'gustavo@rider.test', password: PASSWORD, role: 'admin', isAdmin: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'driver');
    assert.equal(jwt.decode(res.body.tokens.accessToken).role, 'driver');
    const probe = await request(rbacApp).get('/admin-only').set(bearer(res.body.tokens.accessToken));
    assert.equal(probe.status, 403);
  });

  test('email is case-insensitive and trimmed', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: '  GUSTAVO@Rider.Test ', password: PASSWORD });
    assert.equal(res.status, 200);
  });

  test('wrong password and unknown email give the same answer', async () => {
    const wrong = await request(app).post('/api/auth/login').send({ email: 'gustavo@rider.test', password: 'Wrong12345' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@rider.test', password: PASSWORD });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
    assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');
  });

  test('password is case-sensitive', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'gustavo@rider.test', password: PASSWORD.toUpperCase() });
    assert.equal(res.status, 401);
  });

  test('validates input', async () => {
    const empty = await request(app).post('/api/auth/login').send({});
    assert.equal(empty.status, 400);
    assert.deepEqual(fields(empty).sort(), ['email', 'password']);
    const typed = await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: ['x'] });
    assert.equal(typed.status, 400);
  });

  test('SQL injection in the email is just an invalid login', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: "' OR 1=1 --@x.test", password: PASSWORD });
    assert.ok([400, 401].includes(res.status));
  });

  test('records the last login time', async () => {
    const { rows } = await pool.query('SELECT last_login_at FROM users WHERE email = $1', ['gustavo@rider.test']);
    assert.ok(rows[0].last_login_at instanceof Date);
  });

  test('malformed JSON is a 400, not a crash', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_JSON');
  });
});

describe('access tokens', () => {
  test('GET /api/auth/me returns the profile for each role', async () => {
    for (const role of ['restaurant', 'driver', 'admin']) {
      const res = await request(app).get('/api/auth/me').set(bearer(session[role].tokens.accessToken));
      assert.equal(res.status, 200);
      assert.equal(res.body.user.role, role);
      assert.equal(res.body.user.id, session[role].user.id);
    }
  });

  test('missing or malformed credentials are rejected', async () => {
    const token = session.driver.tokens.accessToken;
    const attempts = [
      {},
      { Authorization: token },
      { Authorization: `Basic ${token}` },
      { Authorization: 'Bearer ' },
      { Authorization: 'Bearer not.a.jwt' },
      { Authorization: `Bearer ${token.slice(0, -3)}abc` },
    ];
    for (const headers of attempts) {
      const res = await request(app).get('/api/auth/me').set(headers);
      assert.equal(res.status, 401, JSON.stringify(headers));
    }
  });

  test('a token signed with another secret is rejected', async () => {
    const forged = jwt.sign({ role: 'admin', typ: 'access' }, 'some-other-secret-some-other-secret', {
      subject: session.driver.user.id,
      issuer: 'in-tha-route-api',
      expiresIn: 600,
    });
    const res = await request(app).get('/api/auth/me').set(bearer(forged));
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_TOKEN');
  });

  test('an unsigned (alg none) token is rejected', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: session.admin.user.id, role: 'admin', typ: 'access', iss: 'in-tha-route-api' })}.`;
    const res = await request(app).get('/api/auth/me').set(bearer(none));
    assert.equal(res.status, 401);
  });

  test('an expired token is rejected', async () => {
    const expired = jwt.sign({ role: 'driver', typ: 'access' }, process.env.JWT_SECRET, {
      subject: session.driver.user.id,
      issuer: 'in-tha-route-api',
      expiresIn: -10,
    });
    const res = await request(app).get('/api/auth/me').set(bearer(expired));
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'TOKEN_EXPIRED');
  });

  test('a refresh token cannot be used as an access token', async () => {
    const res = await request(app).get('/api/auth/me').set(bearer(session.driver.tokens.refreshToken));
    assert.equal(res.status, 401);
  });

  test('a token for a user that no longer exists is rejected', async () => {
    const ghost = jwt.sign({ role: 'admin', typ: 'access' }, process.env.JWT_SECRET, {
      subject: '11111111-1111-4111-8111-111111111111',
      issuer: 'in-tha-route-api',
      expiresIn: 600,
    });
    const res = await request(app).get('/api/auth/me').set(bearer(ghost));
    assert.equal(res.status, 401);
  });
});

describe('role-based authorization', () => {
  const matrix = {
    '/admin-only': { admin: 200, restaurant: 403, driver: 403 },
    '/restaurant-only': { admin: 403, restaurant: 200, driver: 403 },
    '/driver-only': { admin: 403, restaurant: 403, driver: 200 },
    '/restaurant-or-admin': { admin: 200, restaurant: 200, driver: 403 },
    '/any-user': { admin: 200, restaurant: 200, driver: 200 },
  };
  for (const [path, expected] of Object.entries(matrix)) {
    for (const [role, status] of Object.entries(expected)) {
      test(`${role} -> ${path} = ${status}`, async () => {
        const res = await request(rbacApp).get(path).set(bearer(session[role].tokens.accessToken));
        assert.equal(res.status, status);
        if (status === 403) assert.equal(res.body.error.code, 'FORBIDDEN');
      });
    }
    test(`anonymous -> ${path} = 401`, async () => {
      assert.equal((await request(rbacApp).get(path)).status, 401);
    });
  }

  test('the role claim inside the token is not trusted; the database role is', async () => {
    // Correctly signed token for the driver, but claiming to be an admin.
    const lying = jwt.sign({ role: 'admin', typ: 'access' }, process.env.JWT_SECRET, {
      subject: session.driver.user.id,
      issuer: 'in-tha-route-api',
      expiresIn: 600,
    });
    const res = await request(rbacApp).get('/admin-only').set(bearer(lying));
    assert.equal(res.status, 403);
    const me = await request(app).get('/api/auth/me').set(bearer(lying));
    assert.equal(me.body.user.role, 'driver');
  });

  test('a role change in the database applies to tokens already issued', async () => {
    const res = await request(app).post('/api/auth/signup').send(driverBody({ email: 'promoted@rider.test' }));
    const token = res.body.tokens.accessToken;
    assert.equal((await request(rbacApp).get('/driver-only').set(bearer(token))).status, 200);
    await pool.query(`DELETE FROM driver_profiles WHERE user_id = $1`, [res.body.user.id]);
    await pool.query(`UPDATE users SET role = 'restaurant' WHERE id = $1`, [res.body.user.id]);
    assert.equal((await request(rbacApp).get('/driver-only').set(bearer(token))).status, 403);
    assert.equal((await request(rbacApp).get('/restaurant-only').set(bearer(token))).status, 200);
  });
});

describe('refresh tokens and logout', () => {
  let first, second;

  test('refresh returns a new token pair', async () => {
    first = (await request(app).post('/api/auth/login').send({ email: 'gustavo@rider.test', password: PASSWORD })).body.tokens;
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: first.refreshToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'driver');
    second = res.body.tokens;
    assert.notEqual(second.refreshToken, first.refreshToken);
    assert.equal((await request(app).get('/api/auth/me').set(bearer(second.accessToken))).status, 200);
  });

  test('a refresh token works only once, and reuse revokes the whole session family', async () => {
    const replay = await request(app).post('/api/auth/refresh').send({ refreshToken: first.refreshToken });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.error.code, 'INVALID_REFRESH_TOKEN');
    const afterReplay = await request(app).post('/api/auth/refresh').send({ refreshToken: second.refreshToken });
    assert.equal(afterReplay.status, 401);
  });

  test('refresh tokens are stored hashed', async () => {
    const t = (await request(app).post('/api/auth/login').send({ email: 'gustavo@rider.test', password: PASSWORD })).body.tokens;
    const { rows } = await pool.query('SELECT 1 FROM refresh_tokens WHERE token_hash = $1', [t.refreshToken]);
    assert.equal(rows.length, 0);
  });

  test('unknown, empty and expired refresh tokens are rejected', async () => {
    assert.equal((await request(app).post('/api/auth/refresh').send({ refreshToken: 'made-up' })).status, 401);
    assert.equal((await request(app).post('/api/auth/refresh').send({})).status, 400);
    const t = (await request(app).post('/api/auth/login').send({ email: 'gustavo@rider.test', password: PASSWORD })).body.tokens;
    await pool.query(`UPDATE refresh_tokens SET expires_at = now() - interval '1 minute' WHERE revoked_at IS NULL`);
    assert.equal((await request(app).post('/api/auth/refresh').send({ refreshToken: t.refreshToken })).status, 401);
  });

  test('an access token cannot be used as a refresh token', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: session.admin.tokens.accessToken });
    assert.equal(res.status, 401);
  });

  test('logout revokes the refresh token', async () => {
    const t = (await request(app).post('/api/auth/login').send({ email: 'staff@saffron.test', password: PASSWORD })).body.tokens;
    assert.equal((await request(app).post('/api/auth/logout').send({ refreshToken: t.refreshToken })).status, 204);
    assert.equal((await request(app).post('/api/auth/refresh').send({ refreshToken: t.refreshToken })).status, 401);
    // Logging out twice is harmless.
    assert.equal((await request(app).post('/api/auth/logout').send({ refreshToken: t.refreshToken })).status, 204);
  });
});

describe('disabled accounts', () => {
  test('cannot log in, use an existing token, or refresh', async () => {
    const signup = await request(app).post('/api/auth/signup').send(driverBody({ email: 'banned@rider.test' }));
    const { accessToken, refreshToken } = signup.body.tokens;
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [signup.body.user.id]);

    const login = await request(app).post('/api/auth/login').send({ email: 'banned@rider.test', password: PASSWORD });
    assert.equal(login.status, 403);
    assert.equal(login.body.error.code, 'ACCOUNT_DISABLED');
    assert.equal((await request(app).get('/api/auth/me').set(bearer(accessToken))).status, 403);
    assert.equal((await request(app).post('/api/auth/refresh').send({ refreshToken })).status, 401);

    // A wrong password on a disabled account does not reveal that it is disabled.
    const wrong = await request(app).post('/api/auth/login').send({ email: 'banned@rider.test', password: 'Wrong12345' });
    assert.equal(wrong.status, 401);
  });
});

describe('database constraints', () => {
  test('reject an unknown role and a platform driver with an employer', async () => {
    await assert.rejects(
      pool.query(`INSERT INTO users (email, password_hash, role, full_name) VALUES ('x@y.test', 'h', 'superuser', 'X')`),
      /users_role_check/
    );
    await assert.rejects(
      pool.query(`INSERT INTO users (email, password_hash, role, full_name) VALUES ('UPPER@y.test', 'h', 'driver', 'X')`),
      /users_email_check/
    );
    await assert.rejects(
      pool.query(
        `UPDATE driver_profiles SET employer_restaurant_id = $1 WHERE user_id = $2`,
        [session.restaurant.user.restaurant.id, session.driver.user.id]
      ),
      /driver_profiles_check/
    );
  });

  test('deleting a user removes their profile and sessions', async () => {
    const res = await request(app).post('/api/auth/signup').send(restaurantBody({ email: 'gone@rest.test' }));
    await pool.query('DELETE FROM users WHERE id = $1', [res.body.user.id]);
    const left = await pool.query(
      `SELECT (SELECT count(*) FROM restaurants WHERE owner_user_id = $1)::int AS r,
              (SELECT count(*) FROM refresh_tokens WHERE user_id = $1)::int AS t`,
      [res.body.user.id]
    );
    assert.deepEqual(left.rows[0], { r: 0, t: 0 });
    assert.equal((await request(app).get('/api/auth/me').set(bearer(res.body.tokens.accessToken))).status, 401);
  });
});

describe('existing routes still work', () => {
  test('health checks and 404', async () => {
    assert.equal((await request(app).get('/')).status, 200);
    assert.equal((await request(app).get('/api/health')).status, 200);
    const dbHealth = await request(app).get('/api/health/db');
    assert.equal(dbHealth.status, 200);
    assert.equal(dbHealth.body.database, 'connected');
    const missing = await request(app).get('/api/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'NOT_FOUND');
  });
});
