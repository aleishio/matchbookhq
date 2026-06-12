import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ConsoleGreeting } from "@/components/ConsoleGreeting";
import "./globals.css";

export const metadata: Metadata = {
  title: "YC OS Events",
  description: "Focused event-prep and approval surfaces for YC events.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/favicon.ico"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ConsoleGreeting />
        {children}
      </body>
    </html>
  );
}
