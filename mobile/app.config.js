/* global __dirname */
const fs = require('fs');
const path = require('path');

/**
 * Extends app.json with values that must not live in git.
 *
 * GOOGLE_MAPS_ANDROID_API_KEY  Google Maps SDK for Android key (restricted to this app).
 *                              Without it the map on Android phones is blank; iOS uses Apple Maps.
 * GOOGLE_SERVICES_JSON         Path to Firebase's google-services.json, needed for push on
 *                              Android. On EAS, upload it as a "file" environment variable with
 *                              this name; locally, put the file in mobile/google-services.json.
 */
module.exports = ({ config }) => {
  const android = { ...config.android };

  const mapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  if (mapsKey) {
    android.config = { ...android.config, googleMaps: { apiKey: mapsKey } };
  }

  const localServices = path.join(__dirname, 'google-services.json');
  const servicesFile =
    process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(localServices) ? './google-services.json' : undefined);
  if (servicesFile) android.googleServicesFile = servicesFile;

  return { ...config, android };
};
