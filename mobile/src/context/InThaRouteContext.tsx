import React, { createContext, useContext, useEffect, useState } from 'react';

import {
  ApiError,
  AuthSession,
  AuthUser,
  logoutRequest,
  refreshRequest,
} from '@/services/authApi';
import { clearSession, loadSession, saveSession } from '@/services/sessionStore';

export type UserRole = 'restaurant' | 'driver' | 'admin';

export type OrderSource = 'Deliveroo' | 'Uber Eats' | 'Eat Presto POS' | 'Just Eat';

export type DriverPolicy = 'open_platform' | 'own_drivers' | 'hybrid';

export interface OrderItem {
  quantity: number;
  name: string;
  price: number;
}

export interface ReceiptTemplate {
  id: string;
  source: OrderSource;
  externalOrderId: string;
  restaurantId: string;
  restaurantName: string;
  restaurantAddress: string;
  restaurantPostcode: string;
  customerName: string;
  customerPhone: string;
  phoneAccessCode?: string;
  directCustomerPhone?: string;
  deliveryAddress: string;
  postcode: string;
  deliveryInstructions: string;
  restaurantPickupNote: string;
  distanceMiles: number;
  suggestedPrepMinutes: number;
  printedTime: string;
  orderTotalGbp: number;
  items: OrderItem[];
  mapCoords: {
    pickupX: number;
    pickupY: number;
    dropoffX: number;
    dropoffY: number;
  };
}

export type OrderStatus =
  | 'preparing'
  | 'ready_for_pickup'
  | 'batched_offered'
  | 'driver_assigned'
  | 'picked_up'
  | 'delivered';

export interface LiveOrder {
  id: string;
  source: OrderSource;
  externalOrderId: string;
  restaurantId: string;
  restaurantName: string;
  restaurantAddress: string;
  restaurantPostcode: string;
  customerName: string;
  customerPhone: string;
  phoneAccessCode?: string;
  directCustomerPhone?: string;
  deliveryAddress: string;
  postcode: string;
  deliveryInstructions: string;
  restaurantPickupNote: string;
  distanceMiles: number;
  prepMinutes: number;
  remainingSeconds: number;
  orderTotalGbp: number;
  items: OrderItem[];
  dispatchType: 'open_platform' | 'own_driver';
  status: OrderStatus;
  assignedDriverId?: string;
  assignedDriverName?: string;
  batchId?: string;
  batchPosition?: number;
  restaurantFeeGbp: number;
  driverPayoutGbp: number;
  createdAtLabel: string;
  mapCoords: {
    pickupX: number;
    pickupY: number;
    dropoffX: number;
    dropoffY: number;
  };
}

export interface KycDocument {
  id: string;
  title: string;
  subtitle: string;
  value: string;
  status: 'verified' | 'pending' | 'missing';
  updatedAt: string;
}

export interface DriverProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  driverType: 'platform_contracted' | 'restaurant_own';
  employerRestaurantId?: string;
  employerRestaurantName?: string;
  vehicle: 'Motorcycle / Scooter' | 'Car' | 'E-Bike';
  plateNumber: string;
  status: 'approved_online' | 'pending_kyc' | 'offline';
  rating: number;
  completedDeliveries: number;
  niNumber?: string;
  bankAccount?: string;
  kycDocuments: KycDocument[];
}

export interface RestaurantPartner {
  id: string;
  name: string;
  address: string;
  postcode: string;
  phone: string;
  driverPolicy: DriverPolicy;
  activeOrdersCount: number;
  completedTodayCount: number;
  pickupSafetyNote: string;
}

export interface AlgorithmConfig {
  baseDistanceMiles: number;
  baseRestaurantChargeGbp: number;
  extraMileRestaurantChargeGbp: number;
  extraMileDriverPayoutGbp: number;
  maxBatchSize: number;
  steppedDriverPayoutsGbp: number[];
  maxPrepTimeWindowMinutes: number;
  maxPickupRadiusMiles: number;
}

export const REAL_RECEIPT_TEMPLATES: ReceiptTemplate[] = [
  {
    id: 'rcpt-deliveroo-8680',
    source: 'Deliveroo',
    externalOrderId: '#8680',
    restaurantId: 'rest-saffron',
    restaurantName: 'Saffron Restaurant - Richmond',
    restaurantAddress: '5 Dome Buildings The Square',
    restaurantPostcode: 'TW9 1DT',
    customerName: 'Anna T.',
    customerPhone: '+442033195035',
    phoneAccessCode: '001902799',
    deliveryAddress: '19 Rosemont Rd, Richmond, London',
    postcode: 'TW10 6QN',
    deliveryInstructions: 'ADD CUTLERY • Phone access code: 001902799',
    restaurantPickupNote:
      'Please collect from stool ONLY when staff member inside is 2 metres distance away behind the counter.',
    distanceMiles: 1.6,
    suggestedPrepMinutes: 20,
    printedTime: '18:15',
    orderTotalGbp: 51.25,
    items: [
      { quantity: 1, name: 'Papad Basket and Pickle Tray', price: 6.0 },
      { quantity: 1, name: 'Spinach and Kale Bhajiyas', price: 7.5 },
      { quantity: 1, name: 'Garlic Naan', price: 4.25 },
      { quantity: 1, name: 'Pulao Rice', price: 5.0 },
      { quantity: 1, name: 'Lamb Biryani', price: 15.0 },
      { quantity: 1, name: 'Mild Butter Chicken', price: 13.5 },
    ],
    mapCoords: { pickupX: 285, pickupY: 130, dropoffX: 195, dropoffY: 175 },
  },
  {
    id: 'rcpt-ubereats-79067',
    source: 'Uber Eats',
    externalOrderId: '#79067',
    restaurantId: 'rest-saffron',
    restaurantName: 'Saffron Restaurant - Richmond',
    restaurantAddress: '5 Dome Buildings The Square',
    restaurantPostcode: 'TW9 1DT',
    customerName: 'Shalini L.',
    customerPhone: '+441388436844',
    phoneAccessCode: '215 97 271',
    directCustomerPhone: '07919077221',
    deliveryAddress: '7 Yeoman Villa Apartments, 2 Bradshaw Close, Twickenham',
    postcode: 'TW1 1FF',
    deliveryInstructions:
      'Use the intercom at Yeoman Villa entrance for flat number 7. Direct phone: 07919077221',
    restaurantPickupNote: 'Ask counter for Uber Eats thermal bag #79067.',
    distanceMiles: 1.5,
    suggestedPrepMinutes: 15,
    printedTime: '17:34',
    orderTotalGbp: 28.5,
    items: [
      { quantity: 1, name: 'Kathal Ki Sabzi', price: 13.0 },
      { quantity: 1, name: 'Channa Paapdi Chaat', price: 7.0 },
      { quantity: 1, name: 'Dal Makhani', price: 8.5 },
    ],
    mapCoords: { pickupX: 285, pickupY: 130, dropoffX: 135, dropoffY: 162 },
  },
  {
    id: 'rcpt-eatpresto-65601',
    source: 'Eat Presto POS',
    externalOrderId: 'WRZMC65601',
    restaurantId: 'rest-eatpresto',
    restaurantName: 'Eat Presto - Isleworth',
    restaurantAddress: '14 South Street, Isleworth',
    restaurantPostcode: 'TW7 7BG',
    customerName: 'Manu Sareen',
    customerPhone: '07766886124',
    deliveryAddress: "68 Saint Mary's Crescent, Isleworth",
    postcode: 'TW7 4NA',
    deliveryInstructions: 'Prepare by 6:55 pm (40min) • Zone A05 • Paid Online',
    restaurantPickupNote: 'Collect from hot shelf A05 — verify order WRZMC65601.',
    distanceMiles: 1.9,
    suggestedPrepMinutes: 40,
    printedTime: '18:15',
    orderTotalGbp: 90.0,
    items: [
      { quantity: 1, name: 'Machi Pakora (Starter)', price: 8.5 },
      { quantity: 1, name: 'Papad Basket & Chutneys (VEGAN)', price: 6.0 },
      { quantity: 2, name: 'Channa Papdi Chaat (G)(D)(V)', price: 14.0 },
      { quantity: 1, name: 'Lamb Biryani (D)', price: 16.5 },
      { quantity: 1, name: 'Jackfruit, Artichoke & Snowpeas Biryani', price: 15.0 },
      { quantity: 2, name: 'Chicken Tikka Biryani (D)', price: 30.0 },
    ],
    mapCoords: { pickupX: 215, pickupY: 95, dropoffX: 110, dropoffY: 115 },
  },
  {
    id: 'rcpt-deliveroo-9555',
    source: 'Deliveroo',
    externalOrderId: '#9555',
    restaurantId: 'rest-amorino',
    restaurantName: 'Amorino - Richmond',
    restaurantAddress: '5 The Quadrant, Richmond',
    restaurantPostcode: 'TW9 1BP',
    customerName: 'Vijay B.',
    customerPhone: '+442033195035',
    phoneAccessCode: '224227568',
    deliveryAddress: '50 Gladstone Avenue, Twickenham',
    postcode: 'TW2 7PR',
    deliveryInstructions: 'Ring the doorbell • ADD CUTLERY • Access code: 224227568',
    restaurantPickupNote:
      'Please collect from stool ONLY when staff member inside is 2 metres distance away behind the counter. Thank you and stay safe!',
    distanceMiles: 2.0,
    suggestedPrepMinutes: 12,
    printedTime: '21:22',
    orderTotalGbp: 29.75,
    items: [
      { quantity: 1, name: 'DS Aloo Tikki Chaat', price: 8.5 },
      { quantity: 1, name: 'Chicken Lollipop', price: 9.5 },
      { quantity: 1, name: 'Garlic Naan', price: 4.25 },
      { quantity: 1, name: 'Lassoni Palak', price: 7.5 },
    ],
    mapCoords: { pickupX: 270, pickupY: 118, dropoffX: 85, dropoffY: 140 },
  },
];

const INITIAL_ALGORITHM: AlgorithmConfig = {
  baseDistanceMiles: 2.0,
  baseRestaurantChargeGbp: 5.0,
  extraMileRestaurantChargeGbp: 1.25,
  extraMileDriverPayoutGbp: 0.9,
  maxBatchSize: 5,
  steppedDriverPayoutsGbp: [4.0, 3.2, 2.8, 2.5, 2.2, 2.0, 1.9, 1.8],
  maxPrepTimeWindowMinutes: 15,
  maxPickupRadiusMiles: 0.8,
};

const INITIAL_RESTAURANTS: RestaurantPartner[] = [
  {
    id: 'rest-saffron',
    name: 'Saffron Restaurant - Richmond',
    address: '5 Dome Buildings The Square, Richmond',
    postcode: 'TW9 1DT',
    phone: '+44 20 8940 5521',
    driverPolicy: 'hybrid',
    activeOrdersCount: 2,
    completedTodayCount: 18,
    pickupSafetyNote:
      'Collect from designated courier counter. Keep 2m distance from kitchen pass.',
  },
  {
    id: 'rest-amorino',
    name: 'Amorino - Richmond',
    address: '5 The Quadrant, Richmond',
    postcode: 'TW9 1BP',
    phone: '+44 20 8332 1920',
    driverPolicy: 'open_platform',
    activeOrdersCount: 1,
    completedTodayCount: 14,
    pickupSafetyNote:
      'Please collect from stool ONLY when staff member inside is 2 metres distance away behind the counter. Thank you and stay safe!',
  },
  {
    id: 'rest-eatpresto',
    name: 'Eat Presto - Isleworth',
    address: '14 South Street, Isleworth',
    postcode: 'TW7 7BG',
    phone: '+44 20 8560 8810',
    driverPolicy: 'open_platform',
    activeOrdersCount: 1,
    completedTodayCount: 11,
    pickupSafetyNote: 'Quote POS Order Reference (WRZ/FZW) at pickup window.',
  },
];

const INITIAL_DRIVERS: DriverProfile[] = [
  {
    id: 'drv-gustavo',
    name: 'Gustavo Oliveira',
    email: 'gustavo.rider@intharoute.co.uk',
    phone: '+44 7841 902145',
    driverType: 'platform_contracted',
    vehicle: 'Motorcycle / Scooter',
    plateNumber: 'LR23 KXM',
    status: 'approved_online',
    rating: 4.96,
    completedDeliveries: 412,
    niNumber: 'QQ 48 91 22 C',
    bankAccount: 'Barclays • 20-71-04 • ••••8821',
    kycDocuments: [
      {
        id: 'doc-1',
        title: 'UK Driving Licence (Photocard)',
        subtitle: 'DVLA Full CBT / A2 Category verified',
        value: 'OLIVE904182GX9IJ',
        status: 'verified',
        updatedAt: 'Verified Oct 12',
      },
      {
        id: 'doc-2',
        title: 'National Insurance (NI) Number',
        subtitle: 'HMRC Self-Employed Courier Tax Check',
        value: 'QQ 48 91 22 C',
        status: 'verified',
        updatedAt: 'Verified Oct 12',
      },
      {
        id: 'doc-3',
        title: 'UK Bank Account & Sort Code',
        subtitle: 'Faster Payments Weekly Settlement',
        value: 'Sort: 20-71-04 • Acc: ••••8821',
        status: 'verified',
        updatedAt: 'Verified Oct 12',
      },
      {
        id: 'doc-4',
        title: 'Hire & Reward Vehicle Insurance',
        subtitle: 'Zego Commercial Food Delivery Policy',
        value: 'Policy #ZG-9948120-UK',
        status: 'verified',
        updatedAt: 'Verified Oct 14',
      },
      {
        id: 'doc-5',
        title: 'Personal & Right-to-Work ID',
        subtitle: 'Passport & Biometric Residence Permit',
        value: 'UK Right to Work Share Code Verified',
        status: 'verified',
        updatedAt: 'Verified Oct 12',
      },
    ],
  },
  {
    id: 'drv-tariq',
    name: 'Tariq Mahmood',
    email: 'tariq.m@intharoute.co.uk',
    phone: '+44 7912 330871',
    driverType: 'platform_contracted',
    vehicle: 'Car',
    plateNumber: 'LV21 TPF',
    status: 'pending_kyc',
    rating: 4.89,
    completedDeliveries: 0,
    niNumber: 'JN 83 10 44 A',
    bankAccount: 'Monzo • 04-00-04 • ••••3109',
    kycDocuments: [
      {
        id: 'doc-t1',
        title: 'UK Driving Licence (Photocard)',
        subtitle: 'Category B Full UK Licence',
        value: 'MAHMO881023TM9AB',
        status: 'verified',
        updatedAt: 'Uploaded Today',
      },
      {
        id: 'doc-t2',
        title: 'National Insurance (NI) Number',
        subtitle: 'HMRC National Insurance Verification',
        value: 'JN 83 10 44 A',
        status: 'pending',
        updatedAt: 'Pending Admin Review',
      },
      {
        id: 'doc-t3',
        title: 'UK Bank Account & Sort Code',
        subtitle: 'Monzo Bank UK Direct Payout',
        value: 'Sort: 04-00-04 • Acc: 99203109',
        status: 'verified',
        updatedAt: 'Uploaded Today',
      },
      {
        id: 'doc-t4',
        title: 'Hire & Reward Vehicle Insurance',
        subtitle: 'Inshur Courier Certificate PDF',
        value: 'Policy #INSH-772019-UK',
        status: 'pending',
        updatedAt: 'Pending Admin Review',
      },
      {
        id: 'doc-t5',
        title: 'Personal & Company Identity Document',
        subtitle: 'UK Passport Scan',
        value: 'Passport #549201823',
        status: 'verified',
        updatedAt: 'Uploaded Today',
      },
    ],
  },
  {
    id: 'drv-carlos-own',
    name: 'Carlos Silva',
    email: 'carlos@saffronrichmond.co.uk',
    phone: '+44 7700 900412',
    driverType: 'restaurant_own',
    employerRestaurantId: 'rest-saffron',
    employerRestaurantName: 'Saffron Restaurant - Richmond',
    vehicle: 'Motorcycle / Scooter',
    plateNumber: 'In-House Fleet #1',
    status: 'approved_online',
    rating: 5.0,
    completedDeliveries: 164,
    kycDocuments: [],
  },
];

const INITIAL_ORDERS: LiveOrder[] = [
  {
    id: 'ord-batch-1',
    source: 'Deliveroo',
    externalOrderId: '#9555',
    restaurantId: 'rest-amorino',
    restaurantName: 'Amorino - Richmond',
    restaurantAddress: '5 The Quadrant, TW9 1BP',
    restaurantPostcode: 'TW9 1BP',
    customerName: 'Horatio Court Customer',
    customerPhone: '+442033195035',
    phoneAccessCode: '676167170',
    deliveryAddress: '6 Hounslow Road, 2 Horatio Court',
    postcode: 'TW2 7EX',
    deliveryInstructions: 'Phone access code: 676167170 • Leave at flat door',
    restaurantPickupNote:
      'Please collect from stool ONLY when staff member inside is 2 metres distance away behind the counter. Thank you and stay safe!',
    distanceMiles: 1.4,
    prepMinutes: 12,
    remainingSeconds: 265,
    orderTotalGbp: 34.5,
    items: [
      { quantity: 1, name: 'Signature Gelato Box (Large)', price: 18.5 },
      { quantity: 4, name: 'Artisanal Macarons Assortment', price: 16.0 },
    ],
    dispatchType: 'open_platform',
    status: 'batched_offered',
    assignedDriverId: 'drv-gustavo',
    assignedDriverName: 'Gustavo Oliveira',
    batchId: 'BATCH-RICHMOND-01',
    batchPosition: 1,
    restaurantFeeGbp: 5.0,
    driverPayoutGbp: 4.0,
    createdAtLabel: 'Just now',
    mapCoords: { pickupX: 270, pickupY: 118, dropoffX: 78, dropoffY: 132 },
  },
  {
    id: 'ord-batch-2',
    source: 'Deliveroo',
    externalOrderId: '#8680',
    restaurantId: 'rest-saffron',
    restaurantName: 'Saffron Restaurant - Richmond',
    restaurantAddress: '5 Dome Buildings The Square, TW9 1DT',
    restaurantPostcode: 'TW9 1DT',
    customerName: 'Anna T.',
    customerPhone: '+442033195035',
    phoneAccessCode: '001902799',
    deliveryAddress: '7 Yew Tree Walk, Hounslow',
    postcode: 'TW4 5HT',
    deliveryInstructions: 'ADD CUTLERY • Phone access code: 001902799',
    restaurantPickupNote:
      'Please collect from stool ONLY when staff member inside is 2 metres distance away behind the counter.',
    distanceMiles: 1.8,
    prepMinutes: 15,
    remainingSeconds: 490,
    orderTotalGbp: 51.25,
    items: [
      { quantity: 1, name: 'Papad Basket and Pickle Tray', price: 6.0 },
      { quantity: 1, name: 'Spinach and Kale Bhajiyas', price: 7.5 },
      { quantity: 1, name: 'Garlic Naan', price: 4.25 },
      { quantity: 1, name: 'Pulao Rice', price: 5.0 },
      { quantity: 1, name: 'Lamb Biryani', price: 15.0 },
      { quantity: 1, name: 'Mild Butter Chicken', price: 13.5 },
    ],
    dispatchType: 'open_platform',
    status: 'batched_offered',
    assignedDriverId: 'drv-gustavo',
    assignedDriverName: 'Gustavo Oliveira',
    batchId: 'BATCH-RICHMOND-01',
    batchPosition: 2,
    restaurantFeeGbp: 5.0,
    driverPayoutGbp: 3.2,
    createdAtLabel: '1 min ago',
    mapCoords: { pickupX: 285, pickupY: 130, dropoffX: 138, dropoffY: 168 },
  },
  {
    id: 'ord-open-3',
    source: 'Uber Eats',
    externalOrderId: '#3B274',
    restaurantId: 'rest-saffron',
    restaurantName: 'Saffron Restaurant - Richmond',
    restaurantAddress: '5 Dome Buildings The Square, TW9 1DT',
    restaurantPostcode: 'TW9 1DT',
    customerName: 'Steve J.',
    customerPhone: '+441388436844',
    phoneAccessCode: '885 20 125',
    deliveryAddress: '8 Albert Rd, Twickenham',
    postcode: 'TW1 4HU',
    deliveryInstructions: 'New customer • Uber Eats PIN #885 20 125',
    restaurantPickupNote: 'Thermal bag sealed at counter #2.',
    distanceMiles: 1.5,
    prepMinutes: 18,
    remainingSeconds: 640,
    orderTotalGbp: 62.65,
    items: [
      { quantity: 1, name: 'Channa Paapdi Chaat', price: 7.0 },
      { quantity: 1, name: 'Spinach and Kale Bhajiyas', price: 7.5 },
      { quantity: 2, name: 'Naan (2 @ £3.95)', price: 7.9 },
      { quantity: 1, name: 'Methi Murg', price: 13.5 },
      { quantity: 1, name: 'Lamb Rogan Josh', price: 15.75 },
    ],
    dispatchType: 'open_platform',
    status: 'preparing',
    restaurantFeeGbp: 5.0,
    driverPayoutGbp: 4.0,
    createdAtLabel: '2 mins ago',
    mapCoords: { pickupX: 285, pickupY: 130, dropoffX: 165, dropoffY: 185 },
  },
  {
    id: 'ord-open-4',
    source: 'Eat Presto POS',
    externalOrderId: 'FZWVW63353',
    restaurantId: 'rest-eatpresto',
    restaurantName: 'Eat Presto - Isleworth',
    restaurantAddress: '14 South Street, Isleworth',
    restaurantPostcode: 'TW7 7BG',
    customerName: 'Georgina Dumler',
    customerPhone: '07906062965',
    deliveryAddress: '38 Shaef Way, Teddington',
    postcode: 'TW11 0DQ',
    deliveryInstructions: 'Prepare by 6:30 pm (51min) A02 • Direct Tel: 07906062965',
    restaurantPickupNote: 'Collect from shelf A02.',
    distanceMiles: 2.0,
    prepMinutes: 25,
    remainingSeconds: 890,
    orderTotalGbp: 50.0,
    items: [
      { quantity: 1, name: 'Veg Punjabi Samosa (2pc) (VEGAN)', price: 6.5 },
      { quantity: 1, name: 'Tamil Nadu Chicken', price: 15.5 },
      { quantity: 1, name: 'Small Aloo Gobi (VEGAN)', price: 9.5 },
      { quantity: 1, name: 'Pork Vindaloo', price: 15.0 },
      { quantity: 1, name: 'Roti (Plain) (VEGAN)', price: 3.5 },
    ],
    dispatchType: 'open_platform',
    status: 'preparing',
    restaurantFeeGbp: 5.0,
    driverPayoutGbp: 4.0,
    createdAtLabel: '4 mins ago',
    mapCoords: { pickupX: 215, pickupY: 95, dropoffX: 190, dropoffY: 205 },
  },
];

export interface RoleScreen {
  key: string;
  title: string;
  subtitle: string;
  icon: string;
}

export const ROLE_SCREENS: Record<UserRole, RoleScreen[]> = {
  restaurant: [
    { key: 'scan_receipt', title: 'New order', subtitle: 'Scan a receipt', icon: 'scan-outline' },
    { key: 'live_orders', title: 'Live orders', subtitle: 'Prep timers & couriers', icon: 'time-outline' },
    { key: 'own_drivers', title: 'My drivers', subtitle: 'Your in-house team', icon: 'people-outline' },
    { key: 'dispatch_policy', title: 'Delivery settings', subtitle: 'Who delivers your orders', icon: 'options-outline' },
  ],
  driver: [
    { key: 'live_route', title: 'Drive', subtitle: 'Offers & navigation', icon: 'navigate-outline' },
    { key: 'open_pool', title: 'Order pool', subtitle: 'Add orders to your route', icon: 'layers-outline' },
    { key: 'earnings', title: 'Earnings', subtitle: 'Payouts & trips', icon: 'wallet-outline' },
    { key: 'kyc_docs', title: 'Documents', subtitle: 'Licence, insurance & ID', icon: 'document-text-outline' },
  ],
  admin: [
    { key: 'live_ledger', title: 'Overview', subtitle: 'Live map & revenue', icon: 'map-outline' },
    { key: 'pricing_algorithm', title: 'Pricing', subtitle: 'Fees & batch payouts', icon: 'calculator-outline' },
    { key: 'driver_kyc', title: 'Drivers', subtitle: 'Approve & contract', icon: 'shield-checkmark-outline' },
    { key: 'partner_restaurants', title: 'Restaurants', subtitle: 'Partners & policies', icon: 'storefront-outline' },
  ],
};

interface InThaRouteContextType {
  /** True while the saved session is being read on launch. */
  isRestoring: boolean;
  isLoggedIn: boolean;
  role: UserRole;
  activeScreen: string;
  setActiveScreen: (screen: string) => void;
  /** The signed-in account, as returned by the API. */
  user: AuthUser | null;
  /** Enter the app with a session from the signup or login API. */
  signIn: (session: AuthSession) => void;
  logout: () => void;
  orders: LiveOrder[];
  drivers: DriverProfile[];
  restaurants: RestaurantPartner[];
  algorithm: AlgorithmConfig;
  activeRestaurantId: string;
  setActiveRestaurantId: (id: string) => void;
  driverBatchStatus: 'offered' | 'accepted_navigating' | 'declined';
  activeStopIndex: number;
  acceptCurrentBatch: () => void;
  declineCurrentBatch: () => void;
  advanceActiveStop: () => void;
  resetDemoBatchOffer: () => void;
  appendOrderToDriverBatch: (orderId: string) => { ok: boolean; message: string };
  publishScannedOrder: (params: {
    template: ReceiptTemplate;
    prepMinutes: number;
    dispatchType: 'open_platform' | 'own_driver';
    ownDriverId?: string;
    customAddress?: string;
    customPostcode?: string;
    customAccessCode?: string;
    autoBatchWithActive?: boolean;
  }) => LiveOrder;
  markOrderReady: (orderId: string) => void;
  addRestaurantOwnDriver: (params: {
    restaurantId: string;
    name: string;
    phone: string;
    vehicle: 'Motorcycle / Scooter' | 'Car' | 'E-Bike';
    plateNumber: string;
  }) => void;
  updateRestaurantPolicy: (restaurantId: string, policy: DriverPolicy) => void;
  uploadDriverKycDoc: (driverId: string, docId: string, newValue: string) => void;
  approveDriverKyc: (driverId: string) => void;
  updateAlgorithmConfig: (partial: Partial<AlgorithmConfig>) => void;
  updateSteppedPayoutAt: (orderPositionIndex: number, amountGbp: number) => void;
  calculateOrderFinancials: (
    distanceMiles: number,
    batchPosition: number,
    dispatchType: 'open_platform' | 'own_driver'
  ) => { restaurantFeeGbp: number; driverPayoutGbp: number; platformMarginGbp: number };
}

const InThaRouteContext = createContext<InThaRouteContextType | undefined>(undefined);

export function InThaRouteProvider({ children }: { children: React.ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [isRestoring, setIsRestoring] = useState<boolean>(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [role, setRoleState] = useState<UserRole>('restaurant');
  const [activeScreen, setActiveScreen] = useState<string>('scan_receipt');
  const [orders, setOrders] = useState<LiveOrder[]>(INITIAL_ORDERS);
  const [drivers, setDrivers] = useState<DriverProfile[]>(INITIAL_DRIVERS);
  const [restaurants, setRestaurants] = useState<RestaurantPartner[]>(INITIAL_RESTAURANTS);
  const [algorithm, setAlgorithm] = useState<AlgorithmConfig>(INITIAL_ALGORITHM);
  const [activeRestaurantId, setActiveRestaurantId] = useState<string>('rest-saffron');

  const [driverBatchStatus, setDriverBatchStatus] = useState<
    'offered' | 'accepted_navigating' | 'declined'
  >('offered');
  const [activeStopIndex, setActiveStopIndex] = useState<number>(0);

  // The role always comes from the server (or from the profile it returned
  // earlier and we stored securely), never from a choice in the UI.
  const enter = (account: AuthUser) => {
    setUser(account);
    setRoleState(account.role);
    setActiveScreen(ROLE_SCREENS[account.role][0].key);
    setIsLoggedIn(true);
  };

  const signIn = (next: AuthSession) => {
    setRefreshToken(next.tokens.refreshToken);
    enter(next.user);
    saveSession(next);
  };

  const signOutLocally = () => {
    setUser(null);
    setRefreshToken(null);
    setIsLoggedIn(false);
    clearSession();
  };

  const logout = () => {
    if (refreshToken) logoutRequest(refreshToken);
    signOutLocally();
  };

  // On launch: reopen the saved account straight away, then confirm it with the
  // server. If the server rejects the session (expired, revoked, account
  // disabled) the user is signed out; if the server is just unreachable they stay in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadSession();
      if (cancelled) return;
      if (!stored) {
        setIsRestoring(false);
        return;
      }
      setRefreshToken(stored.refreshToken);
      enter(stored.user);
      setIsRestoring(false);
      try {
        const fresh = await refreshRequest(stored.refreshToken);
        if (cancelled) return;
        setRefreshToken(fresh.tokens.refreshToken);
        setUser(fresh.user);
        if (fresh.user.role !== stored.user.role) enter(fresh.user);
        await saveSession(fresh);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code !== 'NETWORK_ERROR') signOutLocally();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setOrders((prev) =>
        prev.map((ord) => {
          if (ord.status === 'delivered') return ord;
          const nextRemaining = Math.max(0, ord.remainingSeconds - 1);
          return {
            ...ord,
            remainingSeconds: nextRemaining,
          };
        })
      );
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const calculateOrderFinancials = (
    distanceMiles: number,
    batchPosition: number,
    dispatchType: 'open_platform' | 'own_driver'
  ) => {
    if (dispatchType === 'own_driver') {
      return { restaurantFeeGbp: 0, driverPayoutGbp: 0, platformMarginGbp: 0 };
    }
    const extraMiles = Math.max(0, distanceMiles - algorithm.baseDistanceMiles);
    const restaurantFeeGbp = Number(
      (
        algorithm.baseRestaurantChargeGbp +
        extraMiles * algorithm.extraMileRestaurantChargeGbp
      ).toFixed(2)
    );

    const stepIndex = Math.max(
      0,
      Math.min(batchPosition - 1, algorithm.steppedDriverPayoutsGbp.length - 1)
    );
    const baseDriverPay = algorithm.steppedDriverPayoutsGbp[stepIndex] ?? 2.2;
    const driverPayoutGbp = Number(
      (baseDriverPay + extraMiles * algorithm.extraMileDriverPayoutGbp).toFixed(2)
    );
    const platformMarginGbp = Number((restaurantFeeGbp - driverPayoutGbp).toFixed(2));

    return { restaurantFeeGbp, driverPayoutGbp, platformMarginGbp };
  };

  const recalculateBatchOrders = (
    currentOrders: LiveOrder[],
    nextAlgo: AlgorithmConfig
  ): LiveOrder[] => {
    return currentOrders.map((ord) => {
      if (ord.dispatchType === 'own_driver') return ord;
      const pos = ord.batchPosition ?? 1;
      const extraMiles = Math.max(0, ord.distanceMiles - nextAlgo.baseDistanceMiles);
      const restaurantFeeGbp = Number(
        (
          nextAlgo.baseRestaurantChargeGbp +
          extraMiles * nextAlgo.extraMileRestaurantChargeGbp
        ).toFixed(2)
      );
      const stepIndex = Math.max(
        0,
        Math.min(pos - 1, nextAlgo.steppedDriverPayoutsGbp.length - 1)
      );
      const baseDriverPay = nextAlgo.steppedDriverPayoutsGbp[stepIndex] ?? 2.2;
      const driverPayoutGbp = Number(
        (baseDriverPay + extraMiles * nextAlgo.extraMileDriverPayoutGbp).toFixed(2)
      );
      return {
        ...ord,
        restaurantFeeGbp,
        driverPayoutGbp,
      };
    });
  };

  const publishScannedOrder: InThaRouteContextType['publishScannedOrder'] = ({
    template,
    prepMinutes,
    dispatchType,
    ownDriverId,
    customAddress,
    customPostcode,
    customAccessCode,
    autoBatchWithActive = true,
  }) => {
    const existingBatchOrders = orders.filter(
      (o) => o.batchId === 'BATCH-RICHMOND-01' && o.status !== 'delivered'
    );
    const canJoinBatch =
      dispatchType === 'open_platform' &&
      autoBatchWithActive &&
      existingBatchOrders.length < algorithm.maxBatchSize;

    const batchPosition = canJoinBatch ? existingBatchOrders.length + 1 : 1;
    const financials = calculateOrderFinancials(
      template.distanceMiles,
      batchPosition,
      dispatchType
    );

    const ownDriver = ownDriverId ? drivers.find((d) => d.id === ownDriverId) : undefined;

    const newOrder: LiveOrder = {
      id: `ord-${Date.now()}`,
      source: template.source,
      externalOrderId: template.externalOrderId,
      restaurantId: template.restaurantId,
      restaurantName: template.restaurantName,
      restaurantAddress: template.restaurantAddress,
      restaurantPostcode: template.restaurantPostcode,
      customerName: template.customerName,
      customerPhone: template.customerPhone,
      phoneAccessCode: customAccessCode ?? template.phoneAccessCode,
      directCustomerPhone: template.directCustomerPhone,
      deliveryAddress: customAddress || template.deliveryAddress,
      postcode: customPostcode || template.postcode,
      deliveryInstructions: template.deliveryInstructions,
      restaurantPickupNote: template.restaurantPickupNote,
      distanceMiles: template.distanceMiles,
      prepMinutes,
      remainingSeconds: prepMinutes * 60,
      orderTotalGbp: template.orderTotalGbp,
      items: template.items,
      dispatchType,
      status:
        dispatchType === 'own_driver'
          ? 'driver_assigned'
          : canJoinBatch
          ? driverBatchStatus === 'accepted_navigating'
            ? 'driver_assigned'
            : 'batched_offered'
          : 'preparing',
      assignedDriverId:
        dispatchType === 'own_driver'
          ? ownDriver?.id ?? 'drv-carlos-own'
          : canJoinBatch
          ? 'drv-gustavo'
          : undefined,
      assignedDriverName:
        dispatchType === 'own_driver'
          ? ownDriver?.name ?? 'Carlos Silva (In-House)'
          : canJoinBatch
          ? 'Gustavo Oliveira'
          : undefined,
      batchId: canJoinBatch ? 'BATCH-RICHMOND-01' : undefined,
      batchPosition: canJoinBatch ? batchPosition : 1,
      restaurantFeeGbp: financials.restaurantFeeGbp,
      driverPayoutGbp: financials.driverPayoutGbp,
      createdAtLabel: 'Scanned just now',
      mapCoords: template.mapCoords,
    };

    setOrders((prev) => [newOrder, ...prev]);
    if (canJoinBatch && driverBatchStatus === 'declined') {
      setDriverBatchStatus('offered');
    }
    return newOrder;
  };

  const markOrderReady = (orderId: string) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId ? { ...o, remainingSeconds: 0, status: 'ready_for_pickup' } : o
      )
    );
  };

  const acceptCurrentBatch = () => {
    setDriverBatchStatus('accepted_navigating');
    setActiveStopIndex(0);
    setOrders((prev) =>
      prev.map((o) =>
        o.batchId === 'BATCH-RICHMOND-01' ? { ...o, status: 'driver_assigned' } : o
      )
    );
  };

  const declineCurrentBatch = () => {
    setDriverBatchStatus('declined');
    setOrders((prev) =>
      prev.map((o) =>
        o.batchId === 'BATCH-RICHMOND-01'
          ? {
              ...o,
              batchId: undefined,
              batchPosition: 1,
              assignedDriverId: undefined,
              assignedDriverName: undefined,
              status: 'preparing',
            }
          : o
      )
    );
  };

  const resetDemoBatchOffer = () => {
    setDriverBatchStatus('offered');
    setActiveStopIndex(0);
    setOrders((prev) => {
      let pos = 1;
      return prev.map((o, idx) => {
        if (idx < 2 || o.batchId === 'BATCH-RICHMOND-01') {
          const currentPos = pos++;
          const fin = calculateOrderFinancials(o.distanceMiles, currentPos, 'open_platform');
          return {
            ...o,
            batchId: 'BATCH-RICHMOND-01',
            batchPosition: currentPos,
            assignedDriverId: 'drv-gustavo',
            assignedDriverName: 'Gustavo Oliveira',
            status: 'batched_offered',
            restaurantFeeGbp: fin.restaurantFeeGbp,
            driverPayoutGbp: fin.driverPayoutGbp,
          };
        }
        return o;
      });
    });
  };

  const advanceActiveStop = () => {
    const batchOrders = orders.filter((o) => o.batchId === 'BATCH-RICHMOND-01');
    const totalStops = batchOrders.length * 2;
    if (activeStopIndex + 1 < totalStops) {
      setActiveStopIndex((prev) => prev + 1);
    } else {
      setOrders((prev) =>
        prev.map((o) =>
          o.batchId === 'BATCH-RICHMOND-01' ? { ...o, status: 'delivered', remainingSeconds: 0 } : o
        )
      );
      setActiveStopIndex(0);
    }
  };

  const appendOrderToDriverBatch = (orderId: string) => {
    const currentBatch = orders.filter(
      (o) => o.batchId === 'BATCH-RICHMOND-01' && o.status !== 'delivered'
    );
    if (currentBatch.length >= algorithm.maxBatchSize) {
      return {
        ok: false,
        message: `Maximum batch limit of ${algorithm.maxBatchSize} orders reached.`,
      };
    }

    const nextPosition = currentBatch.length + 1;
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const fin = calculateOrderFinancials(o.distanceMiles, nextPosition, 'open_platform');
        return {
          ...o,
          batchId: 'BATCH-RICHMOND-01',
          batchPosition: nextPosition,
          assignedDriverId: 'drv-gustavo',
          assignedDriverName: 'Gustavo Oliveira',
          status:
            driverBatchStatus === 'accepted_navigating' ? 'driver_assigned' : 'batched_offered',
          restaurantFeeGbp: fin.restaurantFeeGbp,
          driverPayoutGbp: fin.driverPayoutGbp,
        };
      })
    );
    if (driverBatchStatus === 'declined') {
      setDriverBatchStatus('offered');
    }
    return {
      ok: true,
      message: `Added as Order #${nextPosition} in your active batch.`,
    };
  };

  const addRestaurantOwnDriver: InThaRouteContextType['addRestaurantOwnDriver'] = ({
    restaurantId,
    name,
    phone,
    vehicle,
    plateNumber,
  }) => {
    const rest = restaurants.find((r) => r.id === restaurantId);
    const newDriver: DriverProfile = {
      id: `drv-own-${Date.now()}`,
      name,
      email: `${name.toLowerCase().replace(/\s+/g, '.')}@inhouse.local`,
      phone,
      driverType: 'restaurant_own',
      employerRestaurantId: restaurantId,
      employerRestaurantName: rest?.name ?? 'Partner Restaurant',
      vehicle,
      plateNumber: plateNumber || 'In-House Fleet',
      status: 'approved_online',
      rating: 5.0,
      completedDeliveries: 1,
      kycDocuments: [],
    };
    setDrivers((prev) => [newDriver, ...prev]);
  };

  const updateRestaurantPolicy = (restaurantId: string, policy: DriverPolicy) => {
    setRestaurants((prev) =>
      prev.map((r) => (r.id === restaurantId ? { ...r, driverPolicy: policy } : r))
    );
  };

  const uploadDriverKycDoc = (driverId: string, docId: string, newValue: string) => {
    setDrivers((prev) =>
      prev.map((drv) => {
        if (drv.id !== driverId) return drv;
        return {
          ...drv,
          kycDocuments: drv.kycDocuments.map((d) =>
            d.id === docId
              ? { ...d, value: newValue, status: 'pending', updatedAt: 'Submitted just now' }
              : d
          ),
        };
      })
    );
  };

  const approveDriverKyc = (driverId: string) => {
    setDrivers((prev) =>
      prev.map((drv) => {
        if (drv.id !== driverId) return drv;
        return {
          ...drv,
          status: 'approved_online',
          kycDocuments: drv.kycDocuments.map((d) => ({
            ...d,
            status: 'verified',
            updatedAt: 'Approved by Admin',
          })),
        };
      })
    );
  };

  const updateAlgorithmConfig = (partial: Partial<AlgorithmConfig>) => {
    setAlgorithm((prev) => {
      const next = { ...prev, ...partial };
      setOrders((curr) => recalculateBatchOrders(curr, next));
      return next;
    });
  };

  const updateSteppedPayoutAt = (orderPositionIndex: number, amountGbp: number) => {
    setAlgorithm((prev) => {
      const updatedSteps = [...prev.steppedDriverPayoutsGbp];
      updatedSteps[orderPositionIndex] = Number(Math.max(0.5, amountGbp).toFixed(2));
      const next = { ...prev, steppedDriverPayoutsGbp: updatedSteps };
      setOrders((curr) => recalculateBatchOrders(curr, next));
      return next;
    });
  };

  return (
    <InThaRouteContext.Provider
      value={{
        isLoggedIn,
        role,
        activeScreen,
        setActiveScreen,
        isRestoring,
        user,
        signIn,
        logout,
        orders,
        drivers,
        restaurants,
        algorithm,
        activeRestaurantId,
        setActiveRestaurantId,
        driverBatchStatus,
        activeStopIndex,
        acceptCurrentBatch,
        declineCurrentBatch,
        advanceActiveStop,
        resetDemoBatchOffer,
        appendOrderToDriverBatch,
        publishScannedOrder,
        markOrderReady,
        addRestaurantOwnDriver,
        updateRestaurantPolicy,
        uploadDriverKycDoc,
        approveDriverKyc,
        updateAlgorithmConfig,
        updateSteppedPayoutAt,
        calculateOrderFinancials,
      }}>
      {children}
    </InThaRouteContext.Provider>
  );
}

export function useInThaRoute() {
  const ctx = useContext(InThaRouteContext);
  if (!ctx) {
    throw new Error('useInThaRoute must be used inside InThaRouteProvider');
  }
  return ctx;
}
