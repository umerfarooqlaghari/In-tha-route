// Test-data helper for the Maestro flows: talks to the local e2e backend directly so the
// flows only drive the screens they are testing (and receipt scanning, which costs Gemini
// calls, is only used where it is the thing under test).
//
// Inputs (runScript env): ACTION, plus what that action needs. Results go on `output`.
// Accounts come from the e2e seed (see .maestro/README.md).

var API = typeof API_URL !== 'undefined' ? API_URL : 'http://localhost:5075';
var PASSWORD = 'E2ePass123';

function call(method, path, body, token) {
  var headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  var res = http.request(API + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : method === 'GET' ? undefined : '{}' });
  var json = {};
  try {
    json = JSON.parse(res.body);
  } catch (e) {}
  if (res.status >= 400) throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + res.body);
  return json;
}

function login(email) {
  return call('POST', '/api/auth/login', { email: email, password: PASSWORD }).tokens.accessToken;
}

var REF_SEQ = String(Date.now()).slice(-6);

function postOrder(token, extra) {
  var body = {
    source: 'Uber Eats',
    externalOrderId: '#T' + REF_SEQ + Math.floor(Math.random() * 1000),
    customerName: 'Liam Test',
    customerPhone: '+441388436844',
    deliveryAddress: '22 Kings Road, Richmond',
    postcode: 'TW10 6QN',
    prepMinutes: 20,
    dispatchType: 'open_platform',
    items: [],
  };
  for (var k in extra) body[k] = extra[k];
  return call('POST', '/api/restaurant/orders', body, token).order;
}

function driverOnlineHere(token) {
  call('PUT', '/api/driver/availability', { online: true }, token);
  call('PUT', '/api/driver/location', { latitude: 51.462, longitude: -0.304 }, token);
}

/** Finishes every run in progress so each flow starts clean. */
function clearAll() {
  var admin = login('admin@e2e.test');
  var dash = call('GET', '/api/admin/dashboard', null, admin);
  for (var i = 0; i < dash.orders.length; i++) {
    var o = dash.orders[i];
    if (o.status === 'delivered' || o.status === 'cancelled') continue;
    if (o.status === 'picked_up') continue; // finished below by the driver
    call('POST', '/api/admin/orders/' + o.id + '/cancel', { reason: 'e2e reset' }, admin);
  }
  var emails = ['driver1@e2e.test', 'driver2@e2e.test', 'own@e2e.test'];
  for (var j = 0; j < emails.length; j++) {
    var t = login(emails[j]);
    for (var n = 0; n < 20; n++) {
      var d = call('GET', '/api/driver/dashboard', null, t);
      if (d.driverBatchStatus !== 'accepted_navigating' || !d.orders.some(function (x) { return x.batchId; })) break;
      try {
        call('POST', '/api/driver/batch/advance', null, t);
      } catch (e) {
        break;
      }
    }
    try {
      call('POST', '/api/driver/batch/next', null, t);
    } catch (e) {}
  }
  call('PUT', '/api/admin/pricing', { maxBatchSize: 5, offerRadiusMiles: 3, baseRestaurantChargeGbp: 5 }, admin);
  call('PATCH', '/api/restaurant/policy', { driverPolicy: 'open_platform' }, login('rest@e2e.test'));
}

var action = ACTION;
if (action === 'reset') {
  clearAll();
} else if (action === 'poolOrder') {
  // A platform order waiting in the pool.
  var o = postOrder(login('rest@e2e.test'), {});
  output.orderRef = o.externalOrderId;
  output.orderId = o.id;
} else if (action === 'acceptedOrder') {
  // A platform order already accepted by driver2 (for chat / admin move / cancel).
  var r = login('rest@e2e.test');
  var t2 = login('driver2@e2e.test');
  driverOnlineHere(t2);
  var o2 = postOrder(r, {});
  var res = call('POST', '/api/driver/pool/' + o2.id + '/add', null, t2);
  if (!res.ok) throw new Error('driver2 could not accept: ' + res.message);
  output.orderRef = o2.externalOrderId;
  output.orderId = o2.id;
} else if (action === 'setMax') {
  call('PUT', '/api/admin/pricing', { maxBatchSize: Number(MAX) }, login('admin@e2e.test'));
} else if (action === 'ownDriverOrder') {
  // Gives the in-house driver Ali an order (the restaurant's own driver).
  var rt = login('rest@e2e.test');
  var drivers = call('GET', '/api/restaurant/dashboard', null, rt).drivers;
  var ali = drivers.filter(function (x) { return x.name === 'Ali Khan'; })[0];
  var o3 = postOrder(rt, { dispatchType: 'own_driver', ownDriverId: ali.id, source: 'Just Eat' });
  output.orderRef = o3.externalOrderId;
} else if (action === 'ownDriverDeliver') {
  var ot = login('own@e2e.test');
  call('POST', '/api/driver/batch/advance', null, ot); // picked up
  call('POST', '/api/driver/batch/advance', null, ot); // delivered
} else if (action === 'check') {
  // Reads one value back for an assertion: PATH is a dotted path into the admin dashboard.
  var dsh = call('GET', '/api/admin/dashboard', null, login('admin@e2e.test'));
  var parts = String(PATH).split('.');
  var v = dsh;
  for (var p = 0; p < parts.length; p++) v = v[parts[p]];
  output.value = String(v);
} else if (action === 'orderStatus') {
  var all = call('GET', '/api/admin/dashboard', null, login('admin@e2e.test')).orders;
  var hit = all.filter(function (x) { return x.externalOrderId === REF; })[0];
  output.status = hit ? hit.status : 'missing';
} else {
  throw new Error('Unknown ACTION ' + action);
}
