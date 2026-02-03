import React, { useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button"
import { ArrowUpIcon } from "lucide-react"

const LeftCard = () => {
    const click = () => {
        console.log("click!")
    }
    return (
        <div className="absolute top-7 left-0 w-[18%] h-[100%] z-10 bg-white/100 shadow-lg p-4">
            {/* <h3 className="font-bold mb-2">MapLayout</h3> */}
            <div className="flex flex-wrap items-center gap-2 md:flex-row">
                <Button variant="destructive" onClick={click}>Button</Button>
                <Button variant="outline" size="icon" aria-label="Submit">
                    <ArrowUpIcon />
                </Button>
            </div>
        </div>
    )
    
};

export default LeftCard;