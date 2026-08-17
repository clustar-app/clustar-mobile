const IS_PROD = process.env.APP_ENV === "production";

const API_BASE_URL = IS_PROD
  ? "https://api.clustar.space"
  : process.env.API_BASE_URL || "http://172.20.10.4:3000";

export default {
  expo: {
    name: "Clustar",
    slug: "clustar",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "dark",
    scheme: "clustar",
    assetBundlePatterns: ["**/*"],
    ios: {
      supportsTablet: false,
      bundleIdentifier: "com.clustar.mobile",
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          "Clustar shows threads near you and lets you post to your surroundings. Your exact location is never shown to other people.",
        NSLocationAlwaysAndWhenInUseUsageDescription:
          "Travelling clustars follow you as you move, even when the app is closed. Location is only used to update your own clustars — never shared with other people.",
        NSLocationAlwaysUsageDescription:
          "Travelling clustars follow you as you move, even when the app is closed.",
        NSCameraUsageDescription:
          "Clustar uses your camera to snap photos for the clustars you post.",
        NSPhotoLibraryUsageDescription:
          "Clustar attaches photos you choose from your library to your clustars.",
        ITSAppUsesNonExemptEncryption: false,
        UIBackgroundModes: ["location", "fetch"],
      },
    },
    android: {
      package: "com.clustar.mobile",
      googleServicesFile: "./google-services.json",
      softwareKeyboardLayoutMode: "resize",
      adaptiveIcon: {
        backgroundColor: "#09090B",
      },
      permissions: [
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_LOCATION",
      ],
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission:
            "Travelling clustars follow you as you move, even when the app is closed. Location is only used to update your own clustars — never shared with other people.",
          locationWhenInUsePermission:
            "Clustar shows threads near you and lets you post to your surroundings.",
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
        },
      ],
      "expo-font",
      [
        "expo-notifications",
        {
          color: "#FF3B30",
        },
      ],
      [
        "expo-splash-screen",
        {
          backgroundColor: "#09090B",
          image: "./assets/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      apiBaseUrl: API_BASE_URL,
      googleWebClientId:
        "501087107860-rs99clckbsijqh922qlvikadoqm34hgs.apps.googleusercontent.com",
      googleIosClientId:
        "501087107860-narjtg9n8gn31jvmvb5ud784e5i219lu.apps.googleusercontent.com",
      googleAndroidClientId:
        "501087107860-kta8aps9ag2d4vee7vih8a1ijf7ta6o0.apps.googleusercontent.com",
      router: {},
      eas: {
        projectId: "7e2849f9-9eb8-48aa-83e9-1dca928f1468",
      },
    },
    owner: "oceanencrypt",
  },
};
