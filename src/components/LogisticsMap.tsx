
'use client';
import { Truck, Leaf, Clock, MapPin } from 'lucide-react';

export function LogisticsMap() {
  return (
    <div className='relative w-full aspect-video bg-[#ECE6E2] rounded-xl border border-gray-200 overflow-hidden shadow-inner'>
      {/* Base Map */}
      <div className='absolute inset-0 z-0'>
        <iframe 
          width='100%' 
          height='100%' 
          frameBorder='0' 
          scrolling='no' 
          src='https://www.openstreetmap.org/export/embed.html?bbox=72.8,17.3,86.5,28.7&amp;layer=mapnik' 
          style={{ filter: 'grayscale(0.4) brightness(1.1) hue-rotate(5deg)', opacity: 0.8 }}
          className='pointer-events-none'
        ></iframe>
      </div>
      <div className='absolute inset-0 z-0 shadow-inner bg-gradient-to-b from-transparent to-[#ECE6E2]/50 pointer-events-none'></div>

      {/* SVG Routes */}
      <svg className='absolute inset-0 w-full h-full pointer-events-none z-10'>
        {/* Red Route (Standard/High Carbon) */}
        <path d='M 750,300 Q 500,200 150,350' fill='none' stroke='#B14B39' strokeWidth='4' strokeDasharray='8 8' className='animate-pulse' />
        {/* Green Route (Eco-Friendly / EV / Rail) */}
        <path d='M 750,300 Q 400,450 150,350' fill='none' stroke='#3D624F' strokeWidth='6' />
      </svg>

      {/* Origin Pin (e.g. Odisha Artisan) */}
      <div className='absolute top-[40%] right-[20%] group z-20 flex flex-col items-center'>
        <div className='bg-[#14211B] text-white p-2 rounded-full shadow-lg border-2 border-white mb-1'>
          <MapPin size={20} />
        </div>
        <div className='bg-white px-3 py-1 rounded-full shadow text-xs font-bold whitespace-nowrap text-[#14211B]'>Odisha Cluster</div>
      </div>

      {/* Destination Pin (e.g. Mumbai Buyer) */}
      <div className='absolute top-[50%] left-[15%] group z-20 flex flex-col items-center'>
        <div className='bg-[#24332C] text-white p-2 rounded-full shadow-lg border-2 border-white mb-1'>
          <MapPin size={20} />
        </div>
        <div className='bg-white px-3 py-1 rounded-full shadow text-xs font-bold whitespace-nowrap text-[#24332C]'>Mumbai Hub</div>
      </div>

      {/* Route Info Cards */}
      <div className='absolute bottom-6 left-6 right-6 flex gap-4 z-20 overflow-x-auto pb-2'>
        <div className='bg-white/90 backdrop-blur border-2 border-green-500 rounded-xl p-4 flex-1 shadow-xl flex items-center justify-between cursor-pointer'>
          <div className='flex gap-3 items-center'>
            <div className='bg-green-100 p-2 rounded-full text-green-700'><Leaf size={24} /></div>
            <div>
              <div className='font-bold text-gray-900'>Eco-Rail & EV Network</div>
              <div className='text-xs font-bold text-green-600 flex items-center gap-1'><Clock size={12}/> 4-5 Days</div>
            </div>
          </div>
          <div className='text-right'>
            <div className='font-bold text-xl text-green-700'>?850</div>
            <div className='text-[10px] uppercase font-bold text-gray-500 tracking-wider'>Lowest Carbon</div>
          </div>
        </div>

        <div className='bg-white/90 backdrop-blur border border-red-200 rounded-xl p-4 flex-1 shadow-lg flex items-center justify-between opacity-80 cursor-pointer hover:opacity-100 transition-opacity'>
          <div className='flex gap-3 items-center'>
            <div className='bg-red-50 p-2 rounded-full text-red-600'><Truck size={24} /></div>
            <div>
              <div className='font-bold text-gray-900'>Standard Diesel Truck</div>
              <div className='text-xs font-bold text-gray-500 flex items-center gap-1'><Clock size={12}/> 2-3 Days</div>
            </div>
          </div>
          <div className='text-right'>
            <div className='font-bold text-xl text-gray-700'>?1,200</div>
            <div className='text-[10px] uppercase font-bold text-red-500 tracking-wider'>High Emissions</div>
          </div>
        </div>
      </div>
    </div>
  );
}

