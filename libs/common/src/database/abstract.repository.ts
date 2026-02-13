import { Logger, NotFoundException } from '@nestjs/common';
import {
  DeepPartial,
  EntityManager,
  FindOptionsRelations,
  FindOptionsWhere,
  Repository,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AbstractEntity } from './base.entity';

export abstract class AbstractRepository<T extends AbstractEntity<T>> {
  protected abstract readonly logger: Logger;

  constructor(
    protected readonly itemsRepository: Repository<T>,
    private readonly entityManager: EntityManager,
  ) {}

  async create(entity: DeepPartial<T>): Promise<T> {
    const created = this.itemsRepository.create(entity);
    return this.itemsRepository.save(created);
  }

  async findOne(
    where: FindOptionsWhere<T>,
    relations?: FindOptionsRelations<T>,
  ): Promise<T> {
    const entity = await this.itemsRepository.findOne({ where, relations });

    if (!entity) {
      this.logger.warn('Document not found with where', where);
      throw new NotFoundException('Entity not found.');
    }

    return entity;
  }

  async findOneAndUpdate(
    where: FindOptionsWhere<T>,
    partialEntity: QueryDeepPartialEntity<T>,
  ) {
    const updateResult = await this.itemsRepository.update(
      where,
      partialEntity,
    );

    if (!updateResult.affected) {
      this.logger.warn('Entity not found with where', where);
      throw new NotFoundException('Entity not found.');
    }

    return this.findOne(where);
  }

  async find(where: FindOptionsWhere<T>) {
    return this.itemsRepository.findBy(where);
  }

  async findOneAndDelete(where: FindOptionsWhere<T>) {
    await this.itemsRepository.delete(where);
  }
}
