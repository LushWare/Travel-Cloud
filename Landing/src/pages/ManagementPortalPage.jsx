import PORTALS from '../config/portals';
import ProductPageHero from '../components/ProductPageHero';
import ContainerScroll from '../components/ui/ContainerScroll';
import ManagementPortalFeatures from '../components/ManagementPortalFeatures';

export default function ManagementPortalPage({ onOpenDemo }) {
  return (
    <div className="pb-20 bg-white">
      <ProductPageHero
        title="Control, Visibility & Scale for"
        highlight="Your Agency"
        description="Replace disconnected spreadsheets, email threads, and legacy systems with one centralized CRM and operations engine tailored specifically for the travel industry."
        demoLabel="Request Management Demo"
        demoProduct="management"
        sandboxLabel="Live Management Sandbox"
        sandboxUrl={PORTALS.management.url}
        imageSrc="/6.png"
        imageAlt="LushWare travel management dashboard"
        curveStyle="wave"
        actionsSpacing="pt-6"
        animateImage
        onOpenDemo={onOpenDemo}
      />

      <section
        className="bg-gradient-to-b from-white via-slate-50/70 to-white px-4 py-12 sm:px-8 sm:py-16 lg:py-20"
        aria-label="Management portal across desktop and mobile"
      >
        <ContainerScroll className="mx-auto w-full max-w-[900px]">
          <img
            src="/3.png"
            alt="LushTravelCloud management dashboard displayed on a laptop"
            width="1400"
            height="880"
            loading="lazy"
            decoding="async"
            className="mx-auto block h-auto w-full object-contain"
            draggable={false}
          />
        </ContainerScroll>
      </section>

      <ManagementPortalFeatures />
    </div>
  );
}
