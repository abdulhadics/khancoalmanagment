import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/{account/vouchers/**,details/**/export,orders/**/slip,orders/print,reports/**/export}":
      [
        "./node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf",
        "./node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf",
      ],
  },
};

export default nextConfig;
