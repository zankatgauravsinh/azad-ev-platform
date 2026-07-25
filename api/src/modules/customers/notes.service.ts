import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CustomerEventType, Role, type CustomerNoteDto, type CustomerNoteRevisionDto } from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerTimelineService } from './customer-timeline.service';

const authorInclude = {
  author: { select: { id: true, name: true, role: true } },
} satisfies Prisma.CustomerNoteInclude;

type NoteWithAuthor = Prisma.CustomerNoteGetPayload<{ include: typeof authorInclude }>;

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: CustomerTimelineService,
  ) {}

  async create(customerId: string, body: string, userId: string): Promise<CustomerNoteDto> {
    const note = await this.prisma.$transaction(async (tx) => {
      const created = await tx.customerNote.create({
        data: { customerId, authorId: userId, body, createdById: userId, updatedById: userId },
        include: authorInclude,
      });
      await this.timeline.record(
        {
          customerId,
          type: CustomerEventType.NOTE_ADDED,
          title: 'Internal note added',
          description: body.slice(0, 140),
          entityType: 'CustomerNote',
          entityId: created.id,
          actorId: userId,
        },
        tx,
      );
      return created;
    });
    return this.toDto(note);
  }

  async list(customerId: string): Promise<CustomerNoteDto[]> {
    const notes = await this.prisma.customerNote.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: authorInclude,
    });
    return notes.map((n) => this.toDto(n));
  }

  /** Editing archives the previous body as a revision (edit history is preserved). */
  async update(customerId: string, id: string, body: string, userId: string): Promise<CustomerNoteDto> {
    const existing = await this.getOrThrow(customerId, id);
    if (existing.body === body) return this.toDto(existing);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.customerNoteRevision.create({
        data: { noteId: id, body: existing.body, editedById: existing.updatedById ?? existing.authorId },
      });
      return tx.customerNote.update({
        where: { id },
        data: { body, editCount: { increment: 1 }, updatedById: userId },
        include: authorInclude,
      });
    });
    return this.toDto(updated);
  }

  async revisions(customerId: string, id: string): Promise<CustomerNoteRevisionDto[]> {
    await this.getOrThrow(customerId, id);
    const revisions = await this.prisma.customerNoteRevision.findMany({
      where: { noteId: id },
      orderBy: { createdAt: 'desc' },
    });
    return revisions.map((r) => ({
      id: r.id,
      body: r.body,
      editedById: r.editedById,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async remove(customerId: string, id: string, userId: string, role: Role): Promise<void> {
    const note = await this.getOrThrow(customerId, id);
    if (role !== Role.OWNER && role !== Role.MANAGER && note.authorId !== userId) {
      throw new ForbiddenException('You can only delete your own notes');
    }
    await this.prisma.customerNote.delete({ where: { id } });
  }

  private async getOrThrow(customerId: string, id: string): Promise<NoteWithAuthor> {
    const note = await this.prisma.customerNote.findUnique({ where: { id }, include: authorInclude });
    if (!note || note.customerId !== customerId) throw new NotFoundException('Note not found');
    return note;
  }

  private toDto(note: NoteWithAuthor): CustomerNoteDto {
    return {
      id: note.id,
      body: note.body,
      editCount: note.editCount,
      author: note.author,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }
}
