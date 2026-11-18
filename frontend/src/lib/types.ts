/**
 * Shapes returned by the In Tha Route API. Kept in step with the mobile app
 * (mobile/src/context/InThaRouteContext.tsx) so both clients read the same data.
 */
export type UserRole = "restaurant" | "driver" | "admin";

export type OrderSource = "Deliveroo" | "Uber Eats" | "Eat Presto POS" | "Just Eat" | "Other";

export type DriverPolicy = "open_platform" | "own_drivers" | "hybrid";

export type Vehicle = "Motorcycle / Scooter" | "Car" | "E-Bike";

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface OrderItem {
  quantity: number;
  name: string;
  price: number;
}

export type OrderStatus =
  | "preparing"
  | "ready_for_pickup"
  | "batched_offered"
  | "driver_assigned"
  | "picked_up"
  | "delivered"
  | "cancelled";

export interface LiveOrder {
  id: string;
  source: OrderSource;
  externalOrderId: string;
  restaurantId: string;
  restaurantName: string;
  restaurantAddress: string;
  restaurantPostcode: string;
  restaurantPhone?: string;
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
  readyAt?: string;
  remainingSeconds: number;
  orderTotalGbp: number;
  items: OrderItem[];
  dispatchType: "open_platform" | "own_driver";
  status: OrderStatus;
  assignedDriverId?: string;
  assignedDriverName?: string;
  assignedDriverType?: "platform_contracted" | "restaurant_own";
  hybrid?: boolean;
  batchId?: string;
  batchPosition?: number;
  restaurantFeeGbp: number;
  driverPayoutGbp: number;
  platformMarginGbp?: number;
  poolSecondsLeft?: number;
  poolExpiresAt?: string;
  attention?: "no_driver" | "late_delivery";
  hasReceipt?: boolean;
  createdAtLabel: string;
  pickupCoords?: LatLng | null;
  dropoffCoords?: LatLng | null;
}

export interface KycDocument {
  id: string;
  type?: string;
  title: string;
  subtitle: string;
  value: string;
  status: "verified" | "pending" | "missing";
  updatedAt: string;
  hasFile?: boolean;
  fileType?: "image" | "pdf" | "word";
}

export interface DriverProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  driverType: "platform_contracted" | "restaurant_own";
  employerRestaurantId?: string;
  employerRestaurantName?: string;
  vehicle: Vehicle;
  plateNumber: string;
  status: "approved_online" | "pending_kyc" | "offline";
  approval?: "approved" | "rejected" | "pending";
  isOnline?: boolean;
  location?: (LatLng & { updatedAt: string }) | null;
  rating: number;
  completedDeliveries: number;
  activeOrders?: number;
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
  coords?: LatLng | null;
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
  offerRadiusMiles: number;
}

export interface PricingSummary {
  tiers: { position: number; driverPayGbp: number; platformKeepsGbp: number }[];
  simulations: {
    orders: number;
    restaurantsPayGbp: number;
    driverEarnsGbp: number;
    profitGbp: number;
    driverShare: number;
  }[];
}

export interface AdminTotals {
  billedGbp: number;
  driverPayGbp: number;
  profitGbp: number;
}

/** What `GET /api/admin/dashboard` returns. Every admin change endpoint returns `{ dashboard }`. */
export interface AdminDashboard {
  role: "admin";
  orders: LiveOrder[];
  drivers: DriverProfile[];
  restaurants: RestaurantPartner[];
  algorithm: AlgorithmConfig;
  pricingSummary?: PricingSummary;
  totals?: AdminTotals;
}

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  restaurant?: {
    id: string;
    name: string;
    address: string;
    postcode: string;
    phone: string;
    driverPolicy: DriverPolicy;
    pickupSafetyNote: string | null;
  };
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}

export interface AuthSession {
  user: AuthUser;
  tokens: AuthTokens;
}

export interface RestaurantSignup {
  role: "restaurant";
  email: string;
  password: string;
  fullName: string;
  phone: string;
  restaurantName: string;
  address: string;
  postcode: string;
  pickupSafetyNote?: string;
}
