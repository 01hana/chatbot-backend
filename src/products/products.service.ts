import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { PaginationDto } from '../common/dto';
import { Prisma } from '../generated/prisma/client';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(dto: PaginationDto, categoryId?: number) {
    const { page, sizePage } = dto;
    const skip = (page - 1) * sizePage;

    // 1. 建立一個有型別保護的動態查詢容器
    const where: Prisma.productsWhereInput = {};

    // 加入 categoryId 篩選
    if (categoryId) {
      where.categoryId = categoryId;
    }

    // 2. 使用 $transaction 同時獲取資料與「過濾後」的總數
    const [total, products] = await this.prisma.$transaction([
      this.prisma.products.count({ where }), // 這裡一定要帶 where，total 才會正確
      this.prisma.products.findMany({
        where,
        skip,
        take: sizePage,
        orderBy: { updated_at: 'desc' },
        omit: { categoryId: true },
      }),
    ]);

    return {
      data: products,
      total,
      page,
      sizePage,
    };
  }

  async findOne(id: number) {
    const product = await this.prisma.products.findUnique({
      where: { id },
    });

    if (!product) throw new NotFoundException('找不到該商品');

    return product;
  }
}
