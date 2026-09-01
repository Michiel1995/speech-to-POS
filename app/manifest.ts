import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Service Ears — Voice to POS",
    short_name: "Service Ears",
    description: "Minimal AI voice layer for hospitality POS draft orders.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3efe6",
    theme_color: "#102923",
  };
}
