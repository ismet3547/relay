import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Relay — AI Operations Demo", description: "A connected local operations demo with a live conversation and observable AI engine." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
