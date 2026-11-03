const eas = require('./eas.json');

/**
 * Store and TestFlight profiles use production APNs. Development clients keep
 * the development entitlement so it matches their provisioning profile.
 * A local config evaluation has no EAS profile and uses the shipping default.
 */
function iosApnsModeForProfile(profileName, builds) {
  if (!profileName) return 'production';
  const chain = [];
  const seen = new Set();
  let current = profileName;
  while (current && !seen.has(current)) {
    const profile = builds[current];
    if (!profile) return 'development';
    seen.add(current);
    chain.unshift(profile);
    current = profile.extends;
  }
  const resolved = chain.reduce((result, profile) => ({ ...result, ...profile }), {});
  return resolved.distribution === 'store' && resolved.developmentClient !== true
    ? 'production'
    : 'development';
}

function withIosApnsMode(plugin, mode) {
  if (plugin === 'expo-notifications') return ['expo-notifications', { mode }];
  if (Array.isArray(plugin) && plugin[0] === 'expo-notifications') {
    const current = plugin[1];
    const props = current && typeof current === 'object' ? current : {};
    return ['expo-notifications', { ...props, mode }];
  }
  return plugin;
}

module.exports = ({ config }) => {
  const mode = iosApnsModeForProfile(process.env.EAS_BUILD_PROFILE, eas.build);
  return {
    ...config,
    plugins: (config.plugins ?? []).map((plugin) => withIosApnsMode(plugin, mode)),
  };
};

module.exports.iosApnsModeForProfile = iosApnsModeForProfile;
