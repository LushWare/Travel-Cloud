import React from 'react';
import { Shield, Globe, Headphones, Settings, Quote, ArrowRight } from 'lucide-react';

const WhyTravelWithUs = () => {
  return (
    <section className="bg-white py-24 border-t border-gray-100 overflow-hidden relative">
      <div className="absolute right-0 bottom-0 opacity-5 pointer-events-none w-1/2 h-full bg-[url('https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-no-repeat bg-right-bottom" />
      
      <div className="max-w-7xl mx-auto px-6 relative z-10 flex flex-col lg:flex-row gap-16 items-center">
        <div className="flex-1">
          <h2 className="mb-2 font-serif text-4xl leading-tight text-slate-800 md:text-5xl">Why Travel With Us?</h2>
          <p className="text-gray-500 mb-12">Your journey, our priority</p>

          <div className="grid grid-cols-2 gap-y-10 gap-x-8">
            <div>
              <div className="w-10 h-10 rounded-full bg-[#16a34a]/10 flex items-center justify-center text-[#16a34a] mb-4">
                 <Settings className="w-5 h-5" /> {/* Dollar sign substitute mock */}
              </div>
              <h4 className="font-semibold text-slate-800 mb-1 text-[15px]">Best Price Guarantee</h4>
              <p className="text-sm text-gray-500">Great value, always</p>
            </div>
            <div>
              <div className="w-10 h-10 rounded-full bg-[#16a34a]/10 flex items-center justify-center text-[#16a34a] mb-4">
                 <Shield className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-slate-800 mb-1 text-[15px]">Trusted & Safe</h4>
              <p className="text-sm text-gray-500">Your safety matters</p>
            </div>
            <div>
              <div className="w-10 h-10 rounded-full bg-[#16a34a]/10 flex items-center justify-center text-[#16a34a] mb-4">
                 <Globe className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-slate-800 mb-1 text-[15px]">Tailor-Made Itineraries</h4>
              <p className="text-sm text-gray-500">Travel your way</p>
            </div>
            <div>
              <div className="w-10 h-10 rounded-full bg-[#16a34a]/10 flex items-center justify-center text-[#16a34a] mb-4">
                 <Headphones className="w-5 h-5" />
              </div>
              <h4 className="font-semibold text-slate-800 mb-1 text-[15px]">Global Support</h4>
              <p className="text-sm text-gray-500">We're here 24/7</p>
            </div>
          </div>
        </div>

        <div className="flex-1 w-full lg:max-w-md">
          <div className="bg-white rounded-3xl p-8 shadow-xl border border-gray-100 relative">
            <Quote className="absolute top-6 left-6 text-gray-100 w-16 h-16 -z-10" />
            <p className="text-slate-700 italic leading-relaxed mb-6">
              "The trip was beyond our expectations! Everything was perfectly organized, and the team was so helpful throughout."
            </p>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm text-slate-800">— Sarah & James</div>
                <div className="flex text-amber-400 text-xs mt-1">
                  ★★★★★
                </div>
              </div>
              <button className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center hover:bg-slate-800">
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default WhyTravelWithUs;
