import React from 'react';
import { ArrowRight, Users, Compass, Bed, Headphones } from 'lucide-react';

const CuratedExperiences = () => {
  return (
    <section className="border-t border-white/10 bg-[linear-gradient(135deg,#0f2723_0%,#173e4b_55%,#164e3f_100%)] py-20">
      <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div className="pr-4">
          <h2 className="mb-2 font-serif text-5xl leading-tight text-white md:text-6xl">Curated Travel Experiences</h2>
          <p className="mb-14 text-base text-white/70">More than just a trip - it's a story you'll tell forever.</p>
          
          <div className="flex flex-wrap sm:flex-nowrap items-start justify-between gap-6 sm:gap-2 mb-12">
            <div className="flex-1 sm:pr-4 sm:border-r border-white/20">
              <Users className="w-8 h-8 text-[#16a34a] mb-5" strokeWidth={1.5} />
              <h4 className="mb-1.5 text-sm font-semibold text-white">Guided Tours</h4>
              <p className="text-sm leading-relaxed text-white/65">Expert local guides</p>
            </div>
            
            <div className="flex-1 sm:px-4 sm:border-r border-white/20">
              <Compass className="w-8 h-8 text-[#16a34a] mb-5" strokeWidth={1.5} />
              <h4 className="mb-1.5 text-sm font-semibold text-white">Unique Experiences</h4>
              <p className="text-sm leading-relaxed text-white/65">Go beyond the ordinary</p>
            </div>
            
            <div className="flex-1 sm:px-4 sm:border-r border-white/20">
              <Bed className="w-8 h-8 text-[#16a34a] mb-5" strokeWidth={1.5} />
              <h4 className="mb-1.5 text-sm font-semibold text-white">Handpicked Stays</h4>
              <p className="text-sm leading-relaxed text-white/65">Comfort meets luxury</p>
            </div>
            
            <div className="flex-1 sm:pl-4">
              <Headphones className="w-8 h-8 text-[#16a34a] mb-5" strokeWidth={1.5} />
              <h4 className="mb-1.5 text-sm font-semibold text-white">24/7 Support</h4>
              <p className="text-sm leading-relaxed text-white/65">Travel with confidence</p>
            </div>
            
          </div>

          <button className="bg-[#16a34a] hover:bg-[#15803d] text-white px-7 py-3 rounded-full text-base font-medium flex items-center gap-2 transition-colors">
            Explore Experiences <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <div className="relative mx-auto mt-10 h-[480px] w-full max-w-[480px] overflow-visible sm:mx-0 sm:max-w-none lg:mt-0">
          <div className="absolute left-0 top-10 z-10 h-[58%] w-[78%] transform rotate-[-1deg] bg-white p-[6px] shadow-[0_8px_30px_rgb(0,0,0,0.12)] sm:h-[280px] sm:w-[400px]">
             <img src="/8.png" alt="Sunset dinner overlooking the ocean" className="h-full w-full object-cover object-top sm:object-center" />
          </div>
          
          <div className="absolute right-0 top-0 z-20 h-[36%] w-[48%] transform rotate-[6deg] bg-white p-[6px] shadow-[0_8px_25px_rgb(0,0,0,0.15)] sm:h-[170px] sm:w-[240px]">
            <img src="/9.png" alt="Colorful coastal village above the sea" className="h-full w-full object-cover object-top sm:object-center" />
          </div>
          <div className="absolute right-[6%] bottom-[13%] z-30 h-[36%] w-[47%] transform rotate-[-8deg] bg-white p-[6px] shadow-[0_10px_30px_rgb(0,0,0,0.15)] sm:right-6 sm:bottom-16 sm:h-[170px] sm:w-[230px]">
             <img src="/10.png" alt="Snorkeler swimming above a sea turtle" className="h-full w-full object-cover object-top sm:object-center" />
          </div>

          {/* Decorative Leaves */}
          <div className="absolute bottom-12 right-[250px] z-0 transform rotate-[-90deg] w-14 h-14">
            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" className="w-full h-full drop-shadow-sm">
              <path d="M20,85 Q40,65 48,50" stroke="#36e523" strokeWidth="3" fill="none" strokeLinecap="round"/>
              <path d="M45,53 C35,30 25,10 40,5 C48,20 52,38 48,51 Z" fill="#36e523"/>
              <path d="M46,48 C55,25 70,5 85,8 C78,25 62,40 48,47 Z" fill="#36e523"/>
              <path d="M38,62 C55,50 80,45 88,55 C75,68 55,65 38,62 Z" fill="#36e523"/>
            </svg>
          </div>
          <div className="absolute top-[225px] right-0 z-0 h-14 w-14 transform rotate-[6deg] sm:right-[-20px]">
            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" className="w-full h-full drop-shadow-sm">
              <path d="M20,85 Q40,65 48,50" stroke="#36e523" strokeWidth="3" fill="none" strokeLinecap="round"/>
              <path d="M45,53 C35,30 25,10 40,5 C48,20 52,38 48,51 Z" fill="#36e523"/>
              <path d="M46,48 C55,25 70,5 85,8 C78,25 62,40 48,47 Z" fill="#36e523"/>
              <path d="M38,62 C55,50 80,45 88,55 C75,68 55,65 38,62 Z" fill="#36e523"/>
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CuratedExperiences;
