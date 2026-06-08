import {
  IsIn,
  IsObject,
  IsOptional,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { WIDGET_STATUS_VALUES } from '../../../widget-config/widget-config.constants';
import type { WidgetStatus } from '../../../widget-config/widget-config.types';

export type AdminWidgetSettingsVm = {
  status: WidgetStatus;
  welcomeMessage: Record<string, string>;
  quickReplies: Record<string, string[]>;
  disclaimer: Record<string, string>;
  fallbackMessage: Record<string, string>;
};

function IsStringRecord(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isStringRecord',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            Object.values(value as Record<string, unknown>).every(item => typeof item === 'string')
          );
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be an object with string values`;
        },
      },
    });
  };
}

function IsStringArrayRecord(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isStringArrayRecord',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            Object.values(value as Record<string, unknown>).every(
              item => Array.isArray(item) && item.every(arrayItem => typeof arrayItem === 'string'),
            )
          );
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be an object with string array values`;
        },
      },
    });
  };
}

/** DTO for updating admin-managed widget settings. */
export class UpdateWidgetSettingsDto {
  @IsOptional()
  @IsIn([...WIDGET_STATUS_VALUES])
  status?: WidgetStatus;

  @IsOptional()
  @IsObject()
  @IsStringRecord()
  welcomeMessage?: Record<string, string>;

  @IsOptional()
  @IsObject()
  @IsStringArrayRecord()
  quickReplies?: Record<string, string[]>;

  @IsOptional()
  @IsObject()
  @IsStringRecord()
  disclaimer?: Record<string, string>;

  @IsOptional()
  @IsObject()
  @IsStringRecord()
  fallbackMessage?: Record<string, string>;
}
