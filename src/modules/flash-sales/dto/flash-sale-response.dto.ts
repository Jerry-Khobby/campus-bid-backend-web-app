import { BidDto } from './bid.dto';
import { FlashSaleStatus } from './enums';

export class FlashSaleResponseDto {
  _id: string;
  vendorId: string;
  productId: string;
  originalPrice: number;
  startingBid: number;
  currentBid: number;
  currentBidder?: string;
  minimumBidIncrement: number;
  quantity: number;
  startTime: Date;
  endTime: Date;
  status: FlashSaleStatus;
  bids: BidDto[];
  winner?: string;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}
