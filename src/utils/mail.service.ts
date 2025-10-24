import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: this.configService.get<string>("EMAIL_USER"),
        pass: this.configService.get<string>("EMAIL_PASS"),
      },
    });
  }

  /**
   * Sends an email using nodemailer
   * @param to - Recipient email address
   * @param subject - Email subject
   * @param html - Email body HTML
   */
  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    const from = `Campus Bid <${this.configService.get<string>("EMAIL_USER")}>`;

    const mailOptions = {
      from,
      to,
      subject,
      html,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      this.logger.log(`✅ Email sent to ${to} with subject "${subject}"`);
    } catch (err) {
      this.logger.error(
        `❌ Failed to send email to ${to}: ${err.message}`,
        err.stack
      );
      throw err;
    }
  }
}
