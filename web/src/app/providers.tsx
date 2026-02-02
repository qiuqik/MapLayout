// app/providers.tsx - 关键：用 dynamic 确保只在客户端加载
'use client';

import dynamic from 'next/dynamic';

// 1. 动态导入 ChakraProvider，禁用服务端渲染
const DynamicChakraProvider = dynamic(
  () => import('@chakra-ui/react').then((mod) => mod.ChakraProvider),
  { ssr: false, loading: () => null } // ssr: false 是核心，禁用服务端渲染
);

// 2. 封装成组件
export function ChakraProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  // 3. 使用动态导入的 ChakraProvider
  return <DynamicChakraProvider>{children}</DynamicChakraProvider>;
}