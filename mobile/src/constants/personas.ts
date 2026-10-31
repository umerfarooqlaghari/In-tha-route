import type { UserRole } from '@/context/InThaRouteContext';

export interface Persona {
  role: UserRole;
  label: string;
  tagline: string;
  icon: 'storefront-outline' | 'bicycle-outline' | 'briefcase-outline';
  name: string;
  org: string;
  email: string;
}

export const PERSONAS: Record<UserRole, Persona> = {
  restaurant: {
    role: 'restaurant',
    label: 'Restaurant',
    tagline: 'Post orders from receipts',
    icon: 'storefront-outline',
    name: 'Saffron Richmond',
    org: 'Restaurant staff',
    email: 'staff@saffronrichmond.co.uk',
  },
  driver: {
    role: 'driver',
    label: 'Driver',
    tagline: 'Deliver and earn',
    icon: 'bicycle-outline',
    name: 'Gustavo Oliveira',
    org: 'Platform driver',
    email: 'gustavo.rider@intharoute.co.uk',
  },
  admin: {
    role: 'admin',
    label: 'Admin',
    tagline: 'Manage pricing and drivers',
    icon: 'briefcase-outline',
    name: 'Christian Bark',
    org: 'Owner',
    email: 'christian@intharoute.co.uk',
  },
};

