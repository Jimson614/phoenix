import Image from "next/image";
import Link from "next/link";

export function BrandLogo({ variant = "primary", priority = false }: { variant?: "primary" | "light"; priority?: boolean }) {
  return (
    <Link aria-label="Phoenix Nova™ 首页" className="brand-logo" href="/">
      <Image
        alt="Phoenix Nova™ 凤启"
        className="brand-logo__image"
        height={254}
        priority={priority}
        src={`/assets/brand/phoenix-nova-logo-${variant}.png`}
        width={431}
      />
    </Link>
  );
}
