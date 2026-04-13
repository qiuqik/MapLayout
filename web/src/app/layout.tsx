import React from 'react'; 
import { ChakraProvider } from '@chakra-ui/react';
// @ts-ignore
import '@/styles/globals.css'
// @ts-ignore
import 'mapbox-gl/dist/mapbox-gl.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="icon" href="/logo2.svg" type="image/svg+xml" />
      </head>
      <body>
        {children}
      </body>
    </html>
  )
}