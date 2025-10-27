declare module 'authorizenet' {
  export namespace APIContracts {
    class MerchantAuthenticationType {
      setName(name: string): void;
      setTransactionKey(key: string): void;
    }

    class CreditCardType {
      setCardNumber(cardNumber: string): void;
      setExpirationDate(expirationDate: string): void;
      setCardCode(cardCode: string): void;
    }

    class PaymentType {
      setCreditCard(creditCard: CreditCardType): void;
    }

    class TransactionRequestType {
      setTransactionType(type: string): void;
      setAmount(amount: number): void;
      setPayment(payment: PaymentType): void;
    }

    class CreateTransactionRequest {
      setMerchantAuthentication(auth: MerchantAuthenticationType): void;
      setTransactionRequest(request: TransactionRequestType): void;
      getJSON(): any;
    }

    class CreateTransactionResponse {
      constructor(response: any);
      getMessages(): {
        getResultCode(): string;
        getMessage(): Array<{
          getCode(): string;
          getText(): string;
        }>;
      };
      getTransactionResponse(): {
        getTransId(): string;
        getMessages(): {
          getMessage(): Array<{
            getDescription(): string;
          }>;
        };
        getErrors(): {
          getError(): Array<{
            getErrorCode(): string;
            getErrorText(): string;
          }>;
        };
      };
    }

    enum TransactionTypeEnum {
      AUTHCAPTURETRANSACTION = 'authCaptureTransaction'
    }

    enum MessageTypeEnum {
      OK = 'Ok'
    }
  }

  export namespace APIControllers {
    class CreateTransactionController {
      constructor(json: any);
      setEnvironment(env: any): void;
      execute(callback: () => void): void;
      getResponse(): any;
    }
  }

  export namespace Constants {
    namespace endpoint {
      const production: any;
      const sandbox: any;
    }
  }
}
