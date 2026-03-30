import { Controller, Get, Body, Param, ParseIntPipe } from '@nestjs/common';
import { ProductsService } from './products.service';
import { PaginationDto } from '../common/dto';

@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Get(':categoryId/getAll')
  getAll(
    @Body() dto: PaginationDto,
    @Param('categoryId', new ParseIntPipe({ optional: true })) categoryId?: number,
  ) {
    return this.productsService.findAll(dto, categoryId);
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.findOne(id);
  }
}
