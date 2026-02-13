import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { validate as isUuid } from 'uuid';

@Injectable()
export class UuidParamPipe implements PipeTransform<string, string> {
  constructor(private readonly name: string = 'id') {}

  transform(value: string): string {
    if (!isUuid(value)) {
      throw new BadRequestException(`Invalid UUID parameter: ${this.name}`);
    }
    return value;
  }
}
