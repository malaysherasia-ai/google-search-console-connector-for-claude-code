// The connector's own Google OAuth client (type "Desktop app"), so users can
// just click "Sign in with Google" without creating a Google Cloud project.
//
// For installed apps Google states the client secret "is obviously not treated
// as a secret" (https://developers.google.com/identity/protocols/oauth2#installed):
// it ships inside every copy of the app. Sign-in is still protected by PKCE and
// the loopback redirect, and tokens never leave the user's computer.
//
// Leave these empty to require users to bring their own client.
export const BUILTIN_CLIENT = {
  clientId: "",
  clientSecret: "",
};

/** Set to true once Google has verified the app's OAuth consent screen. */
export const BUILTIN_VERIFIED = false;

export const hasBuiltinClient = () => BUILTIN_CLIENT.clientId.length > 0 && BUILTIN_CLIENT.clientSecret.length > 0;
