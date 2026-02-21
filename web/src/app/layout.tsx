import React from 'react'; 
import { ChakraProvider } from '@chakra-ui/react';
import '@/styles/globals.css'
import 'mapbox-gl/dist/mapbox-gl.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/logo2.svg" type="image/svg+xml" />
      </head>
      <body suppressHydrationWarning>
        <ChakraProvider>{children}</ChakraProvider>
      </body>
    </html>
  )
}