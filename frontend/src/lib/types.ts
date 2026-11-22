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
  /** Licence, insurance, ID and right to work run out; NI and bank details don't. */
  canExpire?: boolean;
  /** YYYY-MM-DD, set by an admin; null when not recorded. */
  expiresOn?: string | null;
  /** "expiring" means within 30 days. */
  expiryState?: "valid" | "expiring" | "expired" | null;
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
  /** Admin dashboard only. */
  isActive?: boolean;
  ownerName?: string;
  ownerEmail?: string;
  /** The fee the admin set for this merchant; null means the standard fee. */
  customFeeGbp?: number | null;
  feePerDeliveryGbp?: number;
  credits?: MerchantCreditTotals;
}

/** Per-merchant credit totals on the admin dashboard. */
export interface MerchantCreditTotals {
  balance: number;
  held: number;
  available: number;
  addedCredits: number;
  purchasedCredits: number;
  usedCredits: number;
  paidGbp: number;
  lastPurchaseAt: string | null;
  deliveriesLeft: number | null;
}

/** A merchant's own credits (1 credit = £1). */
export interface CreditSummary {
  balance: number;
  /** Fees of live platform orders, taken when each is delivered. */
  held: number;
  available: number;
  feePerDeliveryGbp: number;
  customFee: boolean;
  deliveriesLeft: number | null;
  addedCredits: number;
  usedCredits: number;
  paidGbp: number;
  deliveriesCharged: number;
  paymentsEnabled: boolean;
  packsGbp: number[];
  minPurchaseGbp: number;
  maxPurchaseGbp: number;
}

export type CreditKind = "purchase" | "grant" | "adjustment" | "delivery";

export interface CreditTransaction {
  id: string;
  restaurantId: string;
  restaurantName: string;
  kind: CreditKind;
  credits: number;
  amountPaidGbp: number | null;
  orderId?: string;
  externalOrderId?: string;
  note: string;
  createdByName?: string;
  createdAt: string;
}

/** A scanned receipt, waiting for the merchant to check and post it. */
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
  orderTotalGbp: number;
  items: OrderItem[];
  estimatedFeeGbp: number;
  receiptFileId?: string;
  pickupCoords?: LatLng | null;
  dropoffCoords?: LatLng | null;
}

/** What `GET /api/restaurant/dashboard` returns. Change endpoints return `{ dashboard }`. */
export interface MerchantDashboard {
  role: "restaurant";
  activeRestaurantId: string;
  restaurants: RestaurantPartner[];
  orders: LiveOrder[];
  drivers: DriverProfile[];
  algorithm: AlgorithmConfig;
  credits?: CreditSummary;
}

export interface PastOrder extends LiveOrder {
  createdAt: string;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  deliveredLabel?: string;
  // Newer servers also list orders cancelled after collection; older ones send only the delivered fields.
  cancelledAt?: string | null;
  finishedAt?: string;
  finishedLabel?: string;
  totalMinutes: number | null;
  deliveryMinutes: number | null;
}

export interface HistoryPage {
  orders: PastOrder[];
  totals: { orders: number; salesGbp: number; feesGbp: number };
  nextBefore: string | null;
}

export interface MerchantAnalytics {
  days: number;
  summary: {
    orders: number;
    salesGbp: number;
    feesGbp: number;
    averageOrderGbp: number;
    cancelled: number;
    active: number;
    completionRate: number | null;
    deliveryMinutes: number | null;
    totalMinutes: number | null;
    prepMinutes: number | null;
  };
  previous: { orders: number; salesGbp: number };
  daily: { date: string; weekday: string; orders: number; salesGbp: number }[];
  hours: { hour: number; orders: number }[];
  drivers: { own: number; platform: number };
  topItems: { name: string; quantity: number }[];
}

export type ChatRole = "restaurant" | "driver";

export interface Conversation {
  id: string;
  counterpart: {
    userId: string;
    role: ChatRole;
    name: string;
    phone: string;
    subtitle: string;
    online: boolean;
    lastSeenAt: string | null;
  };
  lastMessage: { body: string; senderRole: ChatRole; createdAt: string } | null;
  unreadCount: number;
  canMessage: boolean;
  activeOrders: string[];
  otherLastReadAt: string | null;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  body: string;
  senderRole: ChatRole;
  createdAt: string;
  pending?: "sending" | "failed";
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
    /** Path of the merchant's logo on the API, or null. */
    logoUrl?: string | null;
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
