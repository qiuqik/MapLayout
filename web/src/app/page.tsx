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
      <div className="flex flex-col w-screen h-screen overflow-hidden">
        <Header />
        <div className="flex flex-1 overflow-hidden">
          <LeftCard />
          <CoreMap />
          <RightCard />
        </div>
      </div>
    </MapProvider>
  )
}