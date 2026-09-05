const CONFIG = {
  languagesJsonPath: "languages.json",
  defaultSourceLang: "EN",

  // Fill these in after registering a GitHub OAuth App and deploying
  // oauth-worker/ - see README.md. Leave clientId/workerUrl empty to hide
  // the one-click button and fall back to the manual-token sign-in only.
  oauth: {
    clientId: "",
    workerUrl: "",
  },
};
