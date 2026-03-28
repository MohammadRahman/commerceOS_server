/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/modules/comments/comments.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import * as commentsService from './comments.service';

@Controller('v1')
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly svc: commentsService.CommentsService) {}

  // ── Posts ──────────────────────────────────────────────────────────────────

  @Get('comments/posts')
  listPosts(@Request() req: any) {
    return this.svc.listPosts(req.user.orgId);
  }

  @Post('comments/posts/sync')
  syncPosts(@Request() req: any) {
    // No body needed — channel resolved from DB using orgId
    return this.svc.syncPosts(req.user.orgId);
  }

  @Post('comments/posts/:postId/sync')
  syncComments(@Request() req: any, @Param('postId') postId: string) {
    // No accessToken in body — resolved from channel entity
    return this.svc.syncComments(req.user.orgId, postId);
  }

  // ── Comments ───────────────────────────────────────────────────────────────

  @Get('comments')
  listComments(
    @Request() req: any,
    @Query() query: commentsService.ListCommentsQuery,
  ) {
    return this.svc.listComments(req.user.orgId, query);
  }

  // ── Bulk operations ────────────────────────────────────────────────────────

  @Post('comments/bulk/reply')
  bulkReply(@Request() req: any, @Body() body: commentsService.BulkReplyDto) {
    return this.svc.bulkReply(req.user.orgId, body, req.user.id);
  }

  @Post('comments/bulk/move-to-inbox')
  bulkMoveToInbox(
    @Request() req: any,
    @Body() body: commentsService.BulkMoveToInboxDto,
  ) {
    return this.svc.bulkMoveToInbox(req.user.orgId, body);
  }

  @Post('comments/bulk/hide')
  bulkHide(@Request() req: any, @Body() body: commentsService.BulkHideDto) {
    return this.svc.bulkHide(req.user.orgId, body);
  }

  // ── Auto-rules ─────────────────────────────────────────────────────────────

  @Get('comments/rules')
  listRules(@Request() req: any) {
    return this.svc.listRules(req.user.orgId);
  }

  @Post('comments/rules')
  createRule(
    @Request() req: any,
    @Body() body: commentsService.CreateAutoRuleDto,
  ) {
    return this.svc.createRule(req.user.orgId, body);
  }

  @Put('comments/rules/:id')
  updateRule(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: Partial<commentsService.CreateAutoRuleDto>,
  ) {
    return this.svc.updateRule(req.user.orgId, id, body);
  }

  @Patch('comments/rules/:id/toggle')
  toggleRule(@Request() req: any, @Param('id') id: string) {
    return this.svc.toggleRule(req.user.orgId, id);
  }

  @Delete('comments/rules/:id')
  @HttpCode(204)
  deleteRule(@Request() req: any, @Param('id') id: string) {
    return this.svc.deleteRule(req.user.orgId, id);
  }
}
// apps/api/src/modules/comments/comments.controller.ts
// import {
//   Controller,
//   Get,
//   Post,
//   Put,
//   Delete,
//   Patch,
//   Body,
//   Param,
//   Query,
//   UseGuards,
//   Request,
//   HttpCode,
// } from '@nestjs/common';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// import {
//   CommentsService,
//   ListCommentsQuery,
//   BulkReplyDto,
//   BulkMoveToInboxDto,
//   BulkHideDto,
//   CreateAutoRuleDto,
// } from './comments.service';

// @Controller('v1')
// @UseGuards(JwtAuthGuard)
// export class CommentsController {
//   constructor(private readonly svc: CommentsService) {}

//   // ── Posts ──────────────────────────────────────────────────────────────────

//   @Get('comments/posts')
//   listPosts(@Request() req: any) {
//     return this.svc.listPosts(req.user.orgId);
//   }

//   @Post('comments/posts/sync')
//   syncPosts(
//     @Request() req: any,
//     @Body() body: { pageId: string; accessToken: string },
//   ) {
//     return this.svc.syncPosts(req.user.orgId, body.pageId, body.accessToken);
//   }

//   @Post('comments/posts/:postId/sync')
//   syncComments(
//     @Request() req: any,
//     @Param('postId') postId: string,
//     @Body() body: { accessToken: string },
//   ) {
//     return this.svc.syncComments(req.user.orgId, postId, body.accessToken);
//   }

//   // ── Comments ───────────────────────────────────────────────────────────────

//   @Get('comments')
//   listComments(@Request() req: any, @Query() query: ListCommentsQuery) {
//     return this.svc.listComments(req.user.orgId, query);
//   }

//   // ── Bulk operations ────────────────────────────────────────────────────────

//   @Post('comments/bulk/reply')
//   bulkReply(
//     @Request() req: any,
//     @Body() body: BulkReplyDto & { accessToken: string },
//   ) {
//     return this.svc.bulkReply(
//       req.user.orgId,
//       body,
//       body.accessToken,
//       req.user.id,
//     );
//   }

//   @Post('comments/bulk/move-to-inbox')
//   bulkMoveToInbox(
//     @Request() req: any,
//     @Body() body: BulkMoveToInboxDto & { accessToken: string },
//   ) {
//     return this.svc.bulkMoveToInbox(req.user.orgId, body, body.accessToken);
//   }

//   @Post('comments/bulk/hide')
//   bulkHide(
//     @Request() req: any,
//     @Body() body: BulkHideDto & { accessToken: string },
//   ) {
//     return this.svc.bulkHide(req.user.orgId, body, body.accessToken);
//   }

//   // ── Auto-rules ─────────────────────────────────────────────────────────────

//   @Get('comments/rules')
//   listRules(@Request() req: any) {
//     return this.svc.listRules(req.user.orgId);
//   }

//   @Post('comments/rules')
//   createRule(@Request() req: any, @Body() body: CreateAutoRuleDto) {
//     return this.svc.createRule(req.user.orgId, body);
//   }

//   @Put('comments/rules/:id')
//   updateRule(
//     @Request() req: any,
//     @Param('id') id: string,
//     @Body() body: Partial<CreateAutoRuleDto>,
//   ) {
//     return this.svc.updateRule(req.user.orgId, id, body);
//   }

//   @Patch('comments/rules/:id/toggle')
//   toggleRule(@Request() req: any, @Param('id') id: string) {
//     return this.svc.toggleRule(req.user.orgId, id);
//   }

//   @Delete('comments/rules/:id')
//   @HttpCode(204)
//   deleteRule(@Request() req: any, @Param('id') id: string) {
//     return this.svc.deleteRule(req.user.orgId, id);
//   }
// }
