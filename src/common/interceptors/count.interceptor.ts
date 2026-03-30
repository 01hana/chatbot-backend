import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class CountInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map(data => {
        if (!data) return data;

        // 處理分頁格式：{ data: [...], total: 10, ... }
        if (data.data && Array.isArray(data.data)) {
          return {
            ...data,
            data: data.data.map((item: any) => this.transform(item)),
          };
        }

        // 處理純陣列格式：[...]
        if (Array.isArray(data)) {
          return data.map(item => this.transform(item));
        }

        // 處理單一物件格式：{ id: 1, ... }
        return this.transform(data);
      }),
    );
  }

  private transform(item: any) {
    if (!item || typeof item !== 'object' || !item._count) {
      return item;
    }

    const { _count, ...rest } = item;

    // 邏輯：取 _count 物件中的第一個數值作為 count
    // 例如：{ products: 10 } -> 10
    const countValues = Object.values(_count);
    const count = countValues.length > 0 ? countValues[0] : 0;

    return {
      ...rest,
      count, // 扁平化為 count: 10
    };
  }
}
