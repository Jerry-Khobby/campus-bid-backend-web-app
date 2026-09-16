import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import { User, UserDocument } from "../users/schema/user.schema";
import { Vendor, VendorDocument } from "../vendors/schema/vendor.schema";
import { Order, OrderDocument } from "../orders/schema/order.schema";

const TOP_VENDORS_LIMIT = 5;
const RECENT_ORDERS_LIMIT = 5;
const DASHBOARD_TREND_DAYS = 7;
const ANALYTICS_TREND_DAYS = 30;
const CUSTOMER_GROWTH_MONTHS = 6;

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Vendor.name) private readonly vendorModel: Model<VendorDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
  ) {}

  async getDashboard() {
    const [totals, orderStatusBreakdown, recentOrders, revenueTrend, topVendors, revenueByCategory, customerGrowth] =
      await Promise.all([
        this.getPlatformTotals(),
        this.getOrderStatusBreakdown(),
        this.getRecentOrders(RECENT_ORDERS_LIMIT),
        this.getDailyRevenue(this.daysAgo(DASHBOARD_TREND_DAYS)),
        this.getTopVendors(TOP_VENDORS_LIMIT),
        this.getRevenueByCategory(),
        this.getCustomerGrowth(CUSTOMER_GROWTH_MONTHS),
      ]);

    return {
      ...totals,
      orderStatusBreakdown,
      recentOrders,
      revenueTrend,
      topVendors,
      revenueByCategory,
      customerGrowth,
    };
  }

  async getAnalytics() {
    const [revenueTrend, topVendors, revenueByCategory] = await Promise.all([
      this.getDailyRevenue(this.daysAgo(ANALYTICS_TREND_DAYS)),
      this.getTopVendors(TOP_VENDORS_LIMIT),
      this.getRevenueByCategory(),
    ]);

    return { revenueTrend, topVendors, revenueByCategory };
  }

  private async getPlatformTotals() {
    const [totalOrders, revenueResult, activeVendors, pendingVendors, activeCustomers, pendingOrders, completedToday] =
      await Promise.all([
        this.orderModel.countDocuments({}),
        this.orderModel.aggregate([
          { $match: { status: "completed" } },
          { $group: { _id: null, total: { $sum: "$pricing.total" } } },
        ]),
        this.vendorModel.countDocuments({ isActive: true }),
        this.vendorModel.countDocuments({ isActive: false }),
        this.userModel.countDocuments({ role: "student", isActive: true }),
        this.orderModel.countDocuments({ status: "pending" }),
        this.orderModel.countDocuments({ status: "completed", updatedAt: { $gte: this.startOfToday() } }),
      ]);

    return {
      totalRevenue: revenueResult[0]?.total ?? 0,
      totalOrders,
      activeVendors,
      pendingVendors,
      activeCustomers,
      pendingOrders,
      completedToday,
    };
  }

  private async getOrderStatusBreakdown() {
    const results = await this.orderModel.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    return results.map((result) => ({ status: result._id, count: result.count }));
  }

  private async getRecentOrders(limit: number) {
    const orders = await this.orderModel
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("customerId", "email profile.firstName profile.lastName")
      .populate("vendorId", "profile.businessName")
      .lean();

    return orders.map((order) => ({
      orderNumber: order.orderNumber,
      customer: order.customerId,
      vendor: order.vendorId,
      total: order.pricing?.total ?? 0,
      status: order.status,
      createdAt: (order as any).createdAt,
    }));
  }

  private getDailyRevenue(since: Date) {
    return this.orderModel.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          orders: { $sum: 1 },
          revenue: { $sum: "$pricing.total" },
        },
      },
      { $sort: { _id: 1 } },
    ]);
  }

  private getTopVendors(limit: number) {
    return this.orderModel.aggregate([
      { $match: { status: { $ne: "cancelled" } } },
      { $group: { _id: "$vendorId", revenue: { $sum: "$pricing.total" }, orders: { $sum: 1 } } },
      { $sort: { revenue: -1 } },
      { $limit: limit },
      { $lookup: { from: "vendors", localField: "_id", foreignField: "_id", as: "vendor" } },
      { $unwind: "$vendor" },
      {
        $project: {
          vendorId: "$_id",
          name: "$vendor.profile.businessName",
          rating: "$vendor.rating.average",
          revenue: 1,
          orders: 1,
          _id: 0,
        },
      },
    ]);
  }

  /** Cumulative customer count per month, oldest first — starts from a baseline
   * count of everyone who joined before the window so the running total is a
   * real "total customers over time" line, not just new signups in-window. */
  private async getCustomerGrowth(months: number) {
    const since = this.monthsAgo(months);

    const [baselineCount, monthlySignups] = await Promise.all([
      this.userModel.countDocuments({ role: "student", createdAt: { $lt: since } }),
      this.userModel.aggregate([
        { $match: { role: "student", createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, newCustomers: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    let runningTotal = baselineCount;
    return monthlySignups.map((entry) => {
      runningTotal += entry.newCustomers;
      return { month: entry._id, customers: runningTotal };
    });
  }

  private monthsAgo(months: number): Date {
    const date = new Date();
    date.setUTCMonth(date.getUTCMonth() - months);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }

  private getRevenueByCategory() {
    return this.orderModel.aggregate([
      { $unwind: "$items" },
      { $lookup: { from: "products", localField: "items.productId", foreignField: "_id", as: "product" } },
      { $unwind: "$product" },
      {
        $group: {
          _id: "$product.category",
          revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
        },
      },
      { $sort: { revenue: -1 } },
      { $project: { category: "$_id", revenue: 1, _id: 0 } },
    ]);
  }

  private daysAgo(days: number): Date {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }

  private startOfToday(): Date {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    return start;
  }
}
