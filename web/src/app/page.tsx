'use client';
import Header from "@/components/Header"
import CoreMap from "@/components/CoreMap"
import LeftCard from "@/components/leftCard"
import RightCard from "@/components/rightCard";
import { MapProvider } from '@/lib/mapContext'
// import ChatDialog from '@/components/ChatDialog';

export default function Page() {
  return (
    <MapProvider>
      <div className="relative w-screen h-screen overflow-hidden">
        <Header />
        {/* <ChatDialog /> */}
        <CoreMap />
        <LeftCard />
        <RightCard />
      </div>
    </MapProvider>
  )
}